# Auctions Feature - Research & Planning Document

## Overview

This document outlines the research and planning for implementing a live auctions feature for the Fierro Viejo platform. The feature will enable users to bid on steel materials (with flexibility for future material types) through weekly auctions managed by administrators.

**Architecture Approach:** The entire system uses **Event Sourcing + CQRS** patterns, ensuring immutability, full audit trails, and the ability to rebuild state from events. All domain entities (auctions, materials, bids, associations) follow this event-driven architecture for consistency and reliability.

**Design Philosophy:** The system is designed as an **"Industrial surplus marketplace with auctions as a core capability"** rather than a "Steel auction platform". This ensures smooth expansion to construction materials (concrete, wood, glass, etc.) in 2-3 years without rewrites.

## Designing for Future Expansion

### Core Principle: Model Auctions Generically, Model Materials Separately

The system separates **auction mechanics** (generic, reusable) from **material characteristics** (pluggable, extensible). Steel is the first domain, not the platform.

### Key Design Decisions

1. **Domain-Agnostic Events**
   - Events describe _what happened_, not _what material it was_
   - Use `auction_created`, `bid_placed`, `material_approved` (not `steel_auction_created`)
   - Material context provided via metadata/attributes

2. **Event Versioning (Critical)**
   - All events include `schemaVersion` field
   - Never mutate old events
   - Enables schema evolution when adding construction materials

3. **Separation of Concerns**
   - **Auction Service**: Bidding rules, closing logic, anti-sniping, deposits (material-agnostic)
   - **Material Catalog Service**: Steel, concrete, wood validation, attribute schemas (pluggable)

4. **Pluggable Validation & Pricing**
   - Material-specific validators: `SteelValidator`, `ConcreteValidator`, `WoodValidator`
   - Material-specific pricing: `SteelPricingStrategy`, `ConcretePricingStrategy`
   - Auction logic doesn't hardcode material assumptions

5. **Normalized Quantity Model**
   - Avoid hardcoding "tonnes" or "kg"
   - Support multiple units (m³, pallets, bags, pieces) with base unit conversion
   - Prevents rewriting pricing/reporting when adding new material types

6. **Flexible Material Attributes**
   - Use JSONB/object fields for material-specific attributes
   - Avoid rigid columns like `steel_grade`, `steel_thickness`
   - Enables search/filtering across diverse material types

7. **Organization Types**
   - Support `steel_supplier`, `construction_supplier`, `buyer` organization types
   - Category-level permissions
   - Region-specific rules (important for Mexico market)

### Expansion Effort Estimate

**If following these principles:** 🟢 Medium effort (2-3 weeks)

- Add new material schemas
- Add new validators/pricing strategies
- Reuse 90% of auction code

**If not following these principles:** 🔴 High effort (2-3 months)

- Duplicated auction logic
- Forked services
- Messy migrations
- Brittle analytics

## Feature Requirements

### Core Functionality

1. **Auction Management**
   - Weekly auctions (default frequency, configurable by admins)
   - Each auction runs Monday 11am - Thursday 4pm (Mexico City time) by default
   - Configurable auction schedules per auction instance
   - Auction lifecycle: Draft → Scheduled → Live → Closed
   - **Automatic Auction Creation**: When an auction closes, a new auction is automatically created in "scheduled" status with the next scheduled start/end dates based on frequency
   - **Scheduled Activation**: Convex scheduled function runs every minute to check for scheduled auctions whose start date matches current Mexico City time, automatically transitioning them to "live" status
   - **Single Active Auction Constraint**: Only one auction can be "live" at a time (the latest one). Convex validation ensures no duplicate live auctions exist
   - Immutable

2. **Material Management**
   - Material uploads by sellers/users
   - Admin approval workflow before materials appear in auctions
   - Support for steel materials initially, extensible to other material types
   - Auction lifecycle: Draft → under Admin approval → Live → Closed -> or outdated (in case a new event is caputured that replaces this)
   - Rich material metadata (category, form, finish, choice, weight, location, Total Weight (t), Highest Bid (mxn/t), etc.)
   - Immutable
   - **Material Templates**: Sellers can create reusable templates from existing materials or create new templates for frequently listed remnant materials
     - Templates capture all material attributes (categories, form, finish, choice, attributes, location)
     - Templates exclude quantity (sellers specify quantity when creating material from template)
     - Templates can be created from:
       - Existing approved materials (one-click "Save as Template")
       - Scratch (manual template creation)
     - Templates are seller-specific (private to the seller who created them)
     - When creating a material from a template, only quantity needs to be specified
     - Templates can be edited, renamed, or deleted by the seller
     - Template usage history tracked for analytics (how often each template is used)

3. **Bidding System**
   - Users can place bids on materials within active auctions
   - Bids are immutable (cannot be deleted) - requires event sourcing/CQRS pattern
   - Real-time bid updates
   - Highest bid tracking per material

4. **User Roles**
   - **Admin**: Manage auctions, approve materials, configure auction schedules
   - **Seller**: Upload materials for approval
   - **Buyer**: Place bids on materials
   - Users can have multiple roles

## Data Model

### 1. User Roles Table

```typescript
// convex/schema.ts
userRoles: defineTable({
	userId: v.string(),
	roles: v.array(v.union(v.literal("admin"), v.literal("seller"), v.literal("buyer"))),
	// Organization type for future expansion (steel suppliers, construction suppliers, etc.)
	organizationId: v.optional(v.id("organizations")),
	createdAt: v.number(),
	updatedAt: v.number(),
})
	.index("by_user", ["userId"])
	.index("by_organizationId", ["organizationId"]);
```

**Considerations:**

- Roles stored as array to support multiple roles per user
- Organization types enable category-level permissions and region-specific rules
- Critical for Mexico market where different suppliers may have different regulations
- Consider WorkOS organization/team features for enterprise customers
- Organization type can influence which material categories a user can access

### 2. Auction Events (Event Sourcing)

Since auctions are immutable and require a full audit trail, we'll use event sourcing:

```typescript
auctionEvents: defineTable({
	// Event identification
	eventId: v.string(), // Unique event ID
	eventType: v.union(
		v.literal("auction_created"),
		v.literal("auction_scheduled"),
		v.literal("auction_started"),
		v.literal("auction_closed"),
		v.literal("auction_cancelled")
	),

	// Auction reference - uses Convex's built-in _id from auctionAggregates
	// For auction_created events, this is set after the aggregate is created
	auctionId: v.id("auctionAggregates"),

	// Event payload (varies by event type)
	// For auction_created:
	title: v.optional(v.string()),
	startDate: v.optional(v.number()),
	endDate: v.optional(v.number()),
	frequency: v.optional(
		v.union(v.literal("weekly"), v.literal("biweekly"), v.literal("monthly"), v.literal("custom"))
	),
	createdBy: v.optional(v.string()), // userId (admin)

	// For auction_scheduled/started/closed:
	// (no additional payload, state change only)

	// Event versioning (critical for schema evolution)
	schemaVersion: v.number(), // Start at 1, increment on schema changes

	// Async sync tracking for unified event store
	syncedToUnified: v.optional(v.boolean()),

	// Idempotency
	idempotencyKey: v.optional(v.string()),

	// Metadata
	timestamp: v.number(), // Event timestamp
	createdAt: v.number(), // Record creation timestamp
})
	.index("by_auction", ["auctionId"])
	.index("by_event_type", ["eventType"])
	.index("by_idempotency", ["auctionId", "idempotencyKey"])
	.index("by_timestamp", ["timestamp"]);
```

### 3. Auction Aggregates (Read Model / CQRS)

For efficient querying, maintain aggregated views. **Note: Uses Convex's built-in `_id` field for identification (auto-generated UUID).**

```typescript
auctionAggregates: defineTable({
	// Identification: Uses Convex's built-in _id (no custom auctionId needed)
	title: v.optional(v.string()),

	// Scheduling
	startDate: v.number(), // Unix timestamp
	endDate: v.number(), // Unix timestamp
	frequency: v.union(
		v.literal("weekly"),
		v.literal("biweekly"),
		v.literal("monthly"),
		v.literal("custom")
	),

	// Current status (derived from latest event)
	status: v.union(
		v.literal("draft"),
		v.literal("scheduled"),
		v.literal("live"),
		v.literal("closed"),
		v.literal("cancelled")
	),

	// Metadata
	createdBy: v.string(), // userId (admin)
	createdAt: v.number(),
	lastEventId: v.string(), // Latest event that updated this aggregate
	lastUpdated: v.number(),
})
	.index("by_status", ["status"])
	.index("by_date_range", ["startDate", "endDate"])
	.index("by_created_by", ["createdBy"]);
// Note: No "by_auction" index needed - use ctx.db.get(_id) for direct lookups
```

**Considerations:**

- Uses Convex's built-in `_id` field (auto-generated UUID) for unique identification
- No custom ID generation needed - Convex handles uniqueness automatically
- Indexes support efficient queries for active auctions, date ranges
- Status transitions validated in event handlers
- Aggregates can be rebuilt from event stream if needed
- **Single Active Auction Constraint**: Only one auction can have `status: "live"` at a time. This is enforced by:
  - Validation in `createAuction` mutation (prevents manual creation when one is live)
  - Validation in `placeBid` mutation (ensures bidding only on the current live auction)
  - Validation in `activateScheduledAuctions` scheduled function (closes existing live auction before activating new one)
  - The `by_status` index enables efficient queries to check for existing live auctions

### 4. Material Events (Event Sourcing)

Since materials are immutable and require a full audit trail, we'll use event sourcing:

```typescript
materialEvents: defineTable({
	// Event identification
	eventId: v.string(), // Unique event ID
	eventType: v.union(
		v.literal("material_created"),
		v.literal("material_approved"),
		v.literal("material_rejected"),
		v.literal("material_archived"),
		v.literal("material_updated") // For corrections before approval
	),

	// Material reference
	materialId: v.string(), // Human-readable identifier

	// Event payload (varies by event type)
	// For material_created:
	// Note: Material type is determined by categories (e.g., categories in "Aluminum" group indicate aluminum materials)
	categoryIds: v.optional(v.array(v.id("categories"))), // References to categories table

	// Steel-specific attributes (stored in junction tables)
	formIds: v.optional(v.array(v.id("forms"))), // References to forms table
	finishIds: v.optional(v.array(v.id("finishes"))), // References to finishes table
	choiceIds: v.optional(v.array(v.id("choices"))), // References to choices table
	totalWeight: v.optional(v.number()), // Deprecated: use normalizedQuantity instead

	// Normalized quantity model (supports all material types)
	normalizedQuantity: v.optional(
		v.object({
			quantity: v.number(),
			unit: v.string(), // e.g., "ton", "m3", "pallet", "bag", "piece"
			baseUnit: v.string(), // e.g., "kg" for weight-based, "m3" for volume-based
			baseQuantity: v.number(), // Converted to base unit for calculations
		})
	),

	// Flexible material attributes (JSONB-style for future material types)
	// Steel: { grade: "A36", thickness_mm: 6 }
	// Concrete: { compressiveStrength_mpa: 30, form: "precast slab" }
	// Wood: { species: "oak", moistureContent: 12 }
	attributes: v.optional(v.any()), // Flexible schema per material type

	location: v.optional(v.string()),
	sellerId: v.optional(v.string()),

	// For material_created from template:
	templateId: v.optional(v.string()), // If created from a template

	// For material_approved:
	approvedBy: v.optional(v.string()), // userId (admin)

	// For material_rejected:
	rejectionReason: v.optional(v.string()),

	// Event versioning (critical for schema evolution)
	schemaVersion: v.number(), // Start at 1, increment on schema changes

	// Idempotency
	idempotencyKey: v.optional(v.string()),

	// Metadata
	timestamp: v.number(), // Event timestamp
	createdAt: v.number(), // Record creation timestamp
})
	.index("by_material", ["materialId"])
	.index("by_event_type", ["eventType"])
	.index("by_seller", ["sellerId"])
	.index("by_idempotency", ["materialId", "idempotencyKey"])
	.index("by_timestamp", ["timestamp"]);
```

### 5. Material Aggregates (Read Model / CQRS)

For efficient querying, maintain aggregated views:

```typescript
materialAggregates: defineTable({
	// Identification
	materialId: v.string(), // Human-readable identifier

	// Steel-specific attributes (stored in junction tables)
	// Categories are stored in materialCategories junction table
	// Forms are stored in materialForms junction table
	// Finishes are stored in materialFinishes junction table
	// Choices are stored in materialChoices junction table
	totalWeight: v.optional(v.number()), // Deprecated: use normalizedQuantity instead

	// Normalized quantity model (supports all material types)
	// Steel: { quantity: 12, unit: "ton", baseUnit: "kg", baseQuantity: 12000 }
	// Concrete: { quantity: 50, unit: "m3", baseUnit: "m3", baseQuantity: 50 }
	// Wood: { quantity: 100, unit: "pallet", baseUnit: "m3", baseQuantity: 25 }
	normalizedQuantity: v.object({
		quantity: v.number(),
		unit: v.string(), // e.g., "ton", "m3", "pallet", "bag", "piece"
		baseUnit: v.string(), // e.g., "kg" for weight-based, "m3" for volume-based
		baseQuantity: v.number(), // Converted to base unit for calculations
	}),

	// Flexible material attributes (JSONB-style for future material types)
	// Steel: { grade: "A36", thickness_mm: 6, certifications: ["ISO 9001"] }
	// Concrete: { compressiveStrength_mpa: 30, form: "precast slab", admixtures: ["plasticizer"] }
	// Wood: { species: "oak", moistureContent: 12, grade: "select" }
	attributes: v.optional(v.any()), // Flexible schema per material type

	// Common attributes (all material types)
	location: v.string(), // Country/region
	sellerId: v.string(), // userId of seller

	// Template tracking
	templateId: v.optional(v.string()), // If created from a template

	// Search functionality
	// Computed field for full-text search (concatenated: categories, attributes, location, etc.)
	searchableText: v.string(),

	// Current status (derived from latest event)
	status: v.union(
		v.literal("pending"), // Awaiting admin approval
		v.literal("approved"), // Approved, can be added to auctions
		v.literal("rejected"), // Rejected by admin
		v.literal("archived") // Soft delete
	),
	approvedBy: v.optional(v.string()), // userId (admin)
	approvedAt: v.optional(v.number()),
	rejectionReason: v.optional(v.string()),

	// Metadata
	createdAt: v.number(),
	lastEventId: v.string(), // Latest event that updated this aggregate
	lastUpdated: v.number(),
})
	.index("by_seller", ["sellerId"])
	.index("by_status", ["status"])
	.index("by_approval", ["status", "approvedAt"])
	.index("by_material", ["materialId"])
	.searchIndex("by_searchable_text", {
		searchField: "searchableText", // Computed field for full-text search
	});
```

**Considerations:**

- Material type is determined by categories (e.g., categories in "Aluminum" group indicate aluminum materials)
- Steel-specific fields are optional to support other materials
- `searchableText` is a computed field that concatenates searchable attributes (categories, forms, finishes, choices, location, etc.) for efficient full-text search
- The search index enables fast text-based queries across material attributes
- Approval workflow requires admin role check
- Consider adding tags (e.g., "New this week", "Price reduction", "Green Steel")
- Aggregates can be rebuilt from event stream if needed
- Categories are stored in separate `categories` table and linked via `materialCategories` junction table
- Forms are stored in separate `forms` table and linked via `materialForms` junction table
- Finishes are stored in separate `finishes` table and linked via `materialFinishes` junction table
- Choices are stored in separate `choices` table and linked via `materialChoices` junction table

### 6. Material Template Events (Event Sourcing)

Since templates are immutable and require audit trail, we'll use event sourcing:

```typescript
materialTemplateEvents: defineTable({
	// Event identification
	eventId: v.string(), // Unique event ID
	eventType: v.union(
		v.literal("template_created"),
		v.literal("template_updated"),
		v.literal("template_deleted"),
		v.literal("template_used") // Track usage when material is created from template
	),

	// Template reference
	templateId: v.string(), // Human-readable template identifier

	// Event payload (varies by event type)
	// For template_created:
	// Note: Templates capture all material attributes except quantity
	templateName: v.optional(v.string()), // User-friendly name for the template
	categoryIds: v.optional(v.array(v.id("categories"))), // References to categories table

	// Steel-specific attributes (stored in junction tables)
	formIds: v.optional(v.array(v.id("forms"))), // References to forms table
	finishIds: v.optional(v.array(v.id("finishes"))), // References to finishes table
	choiceIds: v.optional(v.array(v.id("choices"))), // References to choices table

	// Flexible material attributes (JSONB-style)
	attributes: v.optional(v.any()), // Flexible schema per material type

	location: v.optional(v.string()),
	sellerId: v.string(), // userId of seller who owns this template

	// For template_created from existing material:
	sourceMaterialId: v.optional(v.string()), // If created from existing material

	// For template_updated:
	// (fields above represent the updated values)

	// For template_used:
	materialId: v.optional(v.string()), // Material created from this template

	// Event versioning (critical for schema evolution)
	schemaVersion: v.number(), // Start at 1, increment on schema changes

	// Idempotency
	idempotencyKey: v.optional(v.string()),

	// Metadata
	timestamp: v.number(), // Event timestamp
	createdAt: v.number(), // Record creation timestamp
})
	.index("by_template", ["templateId"])
	.index("by_seller", ["sellerId"])
	.index("by_event_type", ["eventType"])
	.index("by_idempotency", ["templateId", "idempotencyKey"])
	.index("by_timestamp", ["timestamp"]);
```

### 7. Material Template Aggregates (Read Model / CQRS)

For efficient querying, maintain aggregated views:

```typescript
materialTemplateAggregates: defineTable({
	// Identification
	templateId: v.string(), // Human-readable template identifier
	templateName: v.string(), // User-friendly name

	// Template attributes (same structure as materials, but without quantity)
	categoryIds: v.array(v.id("categories")), // References to categories table

	// Steel-specific attributes (stored in junction tables)
	// Forms are stored in templateForms junction table
	// Finishes are stored in templateFinishes junction table
	// Choices are stored in templateChoices junction table

	// Flexible material attributes (JSONB-style)
	attributes: v.optional(v.any()),

	// Common attributes
	location: v.string(), // Country/region
	sellerId: v.string(), // userId of seller who owns this template

	// Source tracking
	sourceMaterialId: v.optional(v.string()), // If created from existing material

	// Usage statistics
	usageCount: v.number(), // How many times this template has been used
	lastUsedAt: v.optional(v.number()), // Timestamp of last usage

	// Current status (derived from latest event)
	status: v.union(
		v.literal("active"), // Template is available for use
		v.literal("deleted") // Template has been deleted (soft delete for history)
	),

	// Metadata
	createdAt: v.number(),
	lastEventId: v.string(), // Latest event that updated this aggregate
	lastUpdated: v.number(),
})
	.index("by_seller", ["sellerId"])
	.index("by_status", ["status"])
	.index("by_template", ["templateId"])
	.index("by_seller_status", ["sellerId", "status"])
	.searchIndex("by_template_name", {
		searchField: "templateName", // Full-text search for template names
	});
```

**Considerations:**

- Templates are seller-specific (indexed by `sellerId` for efficient queries)
- Templates exclude quantity (sellers specify quantity when creating material from template)
- `usageCount` and `lastUsedAt` enable analytics and template recommendations
- Soft delete (`status: "deleted"`) preserves history while hiding from active templates
- Search index enables fast template name search within seller's templates
- Templates can be created from existing materials or from scratch
- When a material is created from a template, a `template_used` event is created to track usage
- Forms are stored in separate `forms` table and linked via `templateForms` junction table
- Finishes are stored in separate `finishes` table and linked via `templateFinishes` junction table
- Choices are stored in separate `choices` table and linked via `templateChoices` junction table

### 8. Categories Table

Reference table for all material categories, organized by group:

```typescript
categories: defineTable({
	// Category identification
	name: v.string(), // e.g., "Rebars", "Wire Rods", "Aluminum_Flat", "Stainless_Long"
	groupTitle: v.string(), // e.g., "Carbon_Steel_Long", "Aluminum", "Stainless_Steel", "Carbon_Steel_Tubes_And_Pipes", "Alloy_Steel", "Special_Steel"

	// Metadata
	createdAt: v.number(),
})
	.index("by_group", ["groupTitle"])
	.index("by_name", ["name"]);
```

**Category Data (Initial Seed):**

```typescript
// Aluminum group
{ name: "Aluminum_Flat", groupTitle: "Aluminum" }

// Stainless Steel group
{ name: "Stainless_Long", groupTitle: "Stainless_Steel" }
{ name: "Stainless_Tubes_And_Pipes", groupTitle: "Stainless_Steel" }
{ name: "Stainless_Flat", groupTitle: "Stainless_Steel" }

// Carbon Steel Long group
{ name: "Rebars", groupTitle: "Carbon_Steel_Long" }
{ name: "Wire_Rods", groupTitle: "Carbon_Steel_Long" }
{ name: "Heavy_Sections", groupTitle: "Carbon_Steel_Long" }
{ name: "Bars", groupTitle: "Carbon_Steel_Long" }

// Carbon Steel Tubes & Pipes group
{ name: "Welded_Tubes", groupTitle: "Carbon_Steel_Tubes_And_Pipes" }
{ name: "Seamless_Tubes", groupTitle: "Carbon_Steel_Tubes_And_Pipes" }

// Alloy Steel group
{ name: "Alloy_Steel_Long", groupTitle: "Alloy_Steel" }

// Special Steel group
{ name: "Special_Steel_Flat", groupTitle: "Special_Steel" }
{ name: "Special_Steel_Long", groupTitle: "Special_Steel" }
```

**Considerations:**

- Categories are pre-defined and managed by admins
- Group titles organize categories for UI filtering
- Indexes support efficient queries by group or name
- Categories can be extended in the future without schema changes

### 9. Material Categories Junction Table

Many-to-many relationship between materials and categories:

```typescript
materialCategories: defineTable({
	materialId: v.string(), // Human-readable material ID
	categoryId: v.id("categories"), // Reference to categories table

	// Metadata
	createdAt: v.number(),
})
	.index("by_material", ["materialId"])
	.index("by_category", ["categoryId"])
	.index("by_material_category", ["materialId", "categoryId"]);
```

**Considerations:**

- Materials can have multiple categories
- Categories can be associated with multiple materials
- Populated from `materialEvents` when `material_created` or `material_updated` events include `categoryIds`
- Indexes support efficient queries for:
  - All categories for a material
  - All materials with a specific category
  - Filtering materials by category groups
- When material events include categoryIds, the junction table is updated synchronously (CQRS pattern)

### 10. Forms Table

Reference table for all material forms (e.g., "Coils", "Slit Coils", "Sheets", "Plates"):

```typescript
forms: defineTable({
	// Form identification
	name: v.string(), // e.g., "Coils", "Slit Coils", "Sheets", "Plates", "Heavy Plates", "Flat Bars", "Hexagonal Bars", "Round Billets", "Ingots"

	// Metadata
	createdAt: v.number(),
}).index("by_name", ["name"]);
```

**Form Data (Initial Seed):**

```typescript
{
	name: "Round Billets";
}
{
	name: "Ingots";
}
{
	name: "Coils";
}
{
	name: "Slit Coils";
}
{
	name: "Sheets";
}
{
	name: "Plates";
}
{
	name: "Heavy Plates";
}
{
	name: "Flat Bars";
}
{
	name: "Hexagonal Bars";
}
{
	name: "Round Bars";
}
{
	name: "Square Bars";
}
{
	name: "Equal Angles";
}
{
	name: "Unequal Angles";
}
{
	name: "Round Tubes";
}
{
	name: "Square Tubes";
}
{
	name: "Rectangular Tubes";
}
```

**Considerations:**

- Forms are pre-defined and managed by admins
- Indexes support efficient queries by name
- Forms can be extended in the future without schema changes

### 11. Material Forms Junction Table

Many-to-many relationship between materials and forms:

```typescript
materialForms: defineTable({
	materialId: v.string(), // Human-readable material ID
	formId: v.id("forms"), // Reference to forms table

	// Metadata
	createdAt: v.number(),
})
	.index("by_material", ["materialId"])
	.index("by_form", ["formId"])
	.index("by_material_form", ["materialId", "formId"]);
```

**Considerations:**

- Materials can have multiple forms
- Forms can be associated with multiple materials
- Populated from `materialEvents` when `material_created` or `material_updated` events include `formIds`
- Indexes support efficient queries for:
  - All forms for a material
  - All materials with a specific form
- When material events include formIds, the junction table is updated synchronously (CQRS pattern)

### 12. Finishes Table

Reference table for all material finishes (e.g., "Hot Rolled", "Pickled and Oiled", "Cold Rolled"):

```typescript
finishes: defineTable({
	// Finish identification
	name: v.string(), // e.g., "Hot Rolled", "Pickled and Oiled", "Cold Rolled", "Galvanized"

	// Metadata
	createdAt: v.number(),
}).index("by_name", ["name"]);
```

**Finish Data (Initial Seed):**

```typescript
{
	name: "Hot Rolled";
}
{
	name: "Pickled and Oiled";
}
{
	name: "Cold Rolled";
}
{
	name: "Galvanized";
}
{
	name: "Annealed";
}
{
	name: "Normalized";
}
```

**Considerations:**

- Finishes are pre-defined and managed by admins
- Indexes support efficient queries by name
- Finishes can be extended in the future without schema changes

### 13. Material Finishes Junction Table

Many-to-many relationship between materials and finishes:

```typescript
materialFinishes: defineTable({
	materialId: v.string(), // Human-readable material ID
	finishId: v.id("finishes"), // Reference to finishes table

	// Metadata
	createdAt: v.number(),
})
	.index("by_material", ["materialId"])
	.index("by_finish", ["finishId"])
	.index("by_material_finish", ["materialId", "finishId"]);
```

**Considerations:**

- Materials can have multiple finishes
- Finishes can be associated with multiple materials
- Populated from `materialEvents` when `material_created` or `material_updated` events include `finishIds`
- Indexes support efficient queries for:
  - All finishes for a material
  - All materials with a specific finish
- When material events include finishIds, the junction table is updated synchronously (CQRS pattern)

### 14. Choices Table

Reference table for all material choices (e.g., "1st", "2nd", "3rd", "Prime"):

```typescript
choices: defineTable({
	// Choice identification
	name: v.string(), // e.g., "1st", "2nd", "3rd", "4th", "Prime"

	// Metadata
	createdAt: v.number(),
}).index("by_name", ["name"]);
```

**Choice Data (Initial Seed):**

```typescript
{
	name: "1st";
}
{
	name: "2nd";
}
{
	name: "3rd";
}
{
	name: "4th";
}
{
	name: "Prime";
}
```

**Considerations:**

- Choices are pre-defined and managed by admins
- Indexes support efficient queries by name
- Choices can be extended in the future without schema changes

### 15. Material Choices Junction Table

Many-to-many relationship between materials and choices:

```typescript
materialChoices: defineTable({
	materialId: v.string(), // Human-readable material ID
	choiceId: v.id("choices"), // Reference to choices table

	// Metadata
	createdAt: v.number(),
})
	.index("by_material", ["materialId"])
	.index("by_choice", ["choiceId"])
	.index("by_material_choice", ["materialId", "choiceId"]);
```

**Considerations:**

- Materials can have multiple choices
- Choices can be associated with multiple materials
- Populated from `materialEvents` when `material_created` or `material_updated` events include `choiceIds`
- Indexes support efficient queries for:
  - All choices for a material
  - All materials with a specific choice
- When material events include choiceIds, the junction table is updated synchronously (CQRS pattern)

### 16. Template Forms Junction Table

Many-to-many relationship between templates and forms:

```typescript
templateForms: defineTable({
	templateId: v.string(), // Human-readable template ID
	formId: v.id("forms"), // Reference to forms table

	// Metadata
	createdAt: v.number(),
})
	.index("by_template", ["templateId"])
	.index("by_form", ["formId"])
	.index("by_template_form", ["templateId", "formId"]);
```

**Considerations:**

- Templates can have multiple forms
- Forms can be associated with multiple templates
- Populated from `materialTemplateEvents` when `template_created` or `template_updated` events include `formIds`
- When a material is created from a template, the template's forms are copied to the material via `materialForms` junction table

### 17. Template Finishes Junction Table

Many-to-many relationship between templates and finishes:

```typescript
templateFinishes: defineTable({
	templateId: v.string(), // Human-readable template ID
	finishId: v.id("finishes"), // Reference to finishes table

	// Metadata
	createdAt: v.number(),
})
	.index("by_template", ["templateId"])
	.index("by_finish", ["finishId"])
	.index("by_template_finish", ["templateId", "finishId"]);
```

**Considerations:**

- Templates can have multiple finishes
- Finishes can be associated with multiple templates
- Populated from `materialTemplateEvents` when `template_created` or `template_updated` events include `finishIds`
- When a material is created from a template, the template's finishes are copied to the material via `materialFinishes` junction table

### 18. Template Choices Junction Table

Many-to-many relationship between templates and choices:

```typescript
templateChoices: defineTable({
	templateId: v.string(), // Human-readable template ID
	choiceId: v.id("choices"), // Reference to choices table

	// Metadata
	createdAt: v.number(),
})
	.index("by_template", ["templateId"])
	.index("by_choice", ["choiceId"])
	.index("by_template_choice", ["templateId", "choiceId"]);
```

**Considerations:**

- Templates can have multiple choices
- Choices can be associated with multiple templates
- Populated from `materialTemplateEvents` when `template_created` or `template_updated` events include `choiceIds`
- When a material is created from a template, the template's choices are copied to the material via `materialChoices` junction table

### 19. Auction-Material Association Events (Event Sourcing)

Since associations are immutable and require audit trail, we'll use event sourcing:

```typescript
auctionMaterialEvents: defineTable({
	// Event identification
	eventId: v.string(), // Unique event ID
	eventType: v.union(
		v.literal("material_added_to_auction"),
		v.literal("material_removed_from_auction")
	),

	// References
	auctionId: v.string(), // Human-readable auction ID
	materialId: v.string(), // Human-readable material ID

	// Event payload
	addedBy: v.optional(v.string()), // userId (admin) - for added events
	removedBy: v.optional(v.string()), // userId (admin) - for removed events
	removalReason: v.optional(v.string()),

	// Idempotency
	idempotencyKey: v.optional(v.string()),

	// Metadata
	timestamp: v.number(), // Event timestamp
	createdAt: v.number(), // Record creation timestamp
})
	.index("by_auction", ["auctionId"])
	.index("by_material", ["materialId"])
	.index("by_auction_material", ["auctionId", "materialId"])
	.index("by_idempotency", ["auctionId", "materialId", "idempotencyKey"])
	.index("by_timestamp", ["timestamp"]);
```

### 20. Auction-Material Aggregates (Read Model / CQRS)

For efficient querying, maintain aggregated views:

```typescript
auctionMaterialAggregates: defineTable({
	auctionId: v.string(), // Human-readable auction ID
	materialId: v.string(), // Human-readable material ID
	isActive: v.boolean(), // true if material is currently in auction
	addedAt: v.number(),
	addedBy: v.string(), // userId (admin)
	removedAt: v.optional(v.number()),
	removedBy: v.optional(v.string()), // userId (admin)
	removalReason: v.optional(v.string()),
	lastEventId: v.string(), // Latest event that updated this aggregate
	lastUpdated: v.number(),
})
	.index("by_auction", ["auctionId"])
	.index("by_material", ["materialId"])
	.index("by_auction_material", ["auctionId", "materialId"])
	.index("by_active_auction", ["auctionId", "isActive"]);
```

**Considerations:**

- Many-to-many relationship between auctions and materials
- Materials can appear in multiple auctions (e.g., if not sold)
- Indexes support efficient queries for auction listings
- Aggregates track current state, events provide full history

### 21. Bid Events (Event Sourcing)

Since bids cannot be deleted, we'll use an event sourcing pattern where each bid is an immutable event:

```typescript
bidEvents: defineTable({
	// Event identification
	eventId: v.string(), // Unique event ID
	eventType: v.union(
		v.literal("bid_placed"),
		v.literal("bid_updated"), // If we allow bid updates
		v.literal("bid_withdrawn") // Soft withdrawal (still immutable)
	),

	// Bid details
	auctionId: v.id("auctionAggregates"), // Reference to auction
	materialId: v.id("materialAggregates"), // Reference to material
	bidderId: v.string(), // userId

	// Bid amount
	amount: v.number(), // Price per unit (unit determined by material pricing strategy)
	currency: v.string(), // "MXN", "USD", "EUR" etc.
	priceUnit: v.optional(v.string()), // e.g., "MXN/ton", "MXN/m3" (from material pricing strategy)

	// Concurrency control - sequence number for optimistic locking
	sequenceNumber: v.number(), // Increments with each bid on this auction+material

	// Event versioning (critical for schema evolution)
	schemaVersion: v.number(), // Start at 1, increment on schema changes

	// Idempotency
	idempotencyKey: v.optional(v.string()), // Prevent duplicate bids

	// Metadata
	timestamp: v.number(), // Event timestamp
	createdAt: v.number(), // Record creation timestamp
})
	.index("by_auction_material", ["auctionId", "materialId"])
	.index("by_bidder", ["bidderId"])
	.index("by_bidder_timestamp", ["bidderId", "timestamp"]) // For rate limiting with pagination
	.index("by_idempotency", ["bidderId", "idempotencyKey"])
	.index("by_timestamp", ["timestamp"]);
```

**Considerations:**

- Event sourcing ensures immutability and audit trail
- `idempotencyKey` prevents duplicate bids from retries/double-clicks
- `sequenceNumber` enables optimistic concurrency control to prevent race conditions
- Indexes support efficient queries for:
  - Highest bid per material (query by auctionId + materialId, order by timestamp desc)
  - User's bid history (by_bidder)
  - Rate limiting with pagination (by_bidder_timestamp)
  - Real-time bid updates (by_timestamp)

### 22. Bid Aggregates (Read Model / CQRS)

For efficient querying, maintain aggregated views:

```typescript
bidAggregates: defineTable({
	auctionId: v.id("auctionAggregates"), // Reference to auction
	materialId: v.id("materialAggregates"), // Reference to material

	// Current highest bid
	highestBidAmount: v.number(),
	highestBidderId: v.string(),
	highestBidEventId: v.string(),
	highestBidTimestamp: v.number(),

	// Concurrency control - sequence number for optimistic locking
	currentSequence: v.number(), // Current sequence number, incremented with each bid

	// Statistics
	totalBids: v.number(),
	uniqueBidders: v.number(),

	// Last updated
	lastUpdated: v.number(),
})
	.index("by_auction_material", ["auctionId", "materialId"])
	.index("by_auction", ["auctionId"]);
```

**Considerations:**

- Read model updated via Convex scheduled functions or mutations
- Supports fast queries for "Highest Bid" display
- `currentSequence` enables optimistic concurrency control - clients must provide expected sequence
- Can be rebuilt from event stream if needed (event sourcing benefit)

### 23. Unified Event Store (Optional - Global Event Stream)

For cross-domain event processing, analytics, and global event stream queries, we can add a unified event store that captures all events from all domains. **This is populated asynchronously via a scheduled function** to avoid consistency issues with dual writes.

**Domain Event Tables - Add sync tracking field:**

All domain event tables (`auctionEvents`, `materialEvents`, `bidEvents`, etc.) should include:

```typescript
// Add to all domain event tables
syncedToUnified: v.optional(v.boolean()), // Track if synced to allEvents
```

**Unified Event Store Schema:**

```typescript
allEvents: defineTable({
	// Event identification
	eventId: v.string(), // Unique event ID (same as domain event)
	eventType: v.string(), // Full event type: "auction.created", "material.approved", "bid.placed", etc.

	// Aggregate information
	aggregateType: v.union(
		v.literal("auction"),
		v.literal("material"),
		v.literal("auctionMaterial"),
		v.literal("bid"),
		v.literal("materialTemplate")
	),
	aggregateId: v.string(), // The ID of the aggregate (auctionId, materialId, etc.)

	// Event payload (full event data as JSON)
	payload: v.any(), // Complete event payload from domain event

	// Flattened metadata for indexing (Convex doesn't support nested field indexes)
	userId: v.string(), // User who triggered the event
	timestamp: v.number(), // Event timestamp (top-level for indexing)
	idempotencyKey: v.optional(v.string()),

	// Reference to domain-specific event table
	domainEventRef: v.string(), // Format: "{tableName}:{_id}" e.g., "auctionEvents:j123abc"

	// Metadata
	createdAt: v.number(), // Record creation timestamp
})
	.index("by_event_type", ["eventType"])
	.index("by_aggregate", ["aggregateType", "aggregateId"])
	.index("by_timestamp", ["timestamp"]) // Top-level field for proper indexing
	.index("by_user", ["userId"]) // Top-level field for proper indexing
	.index("by_aggregate_type", ["aggregateType"])
	.index("by_domain_ref", ["domainEventRef"]);
```

**Async Sync via Scheduled Function:**

```typescript
// convex/crons.ts - Add to existing crons
crons.interval(
	"sync events to unified store",
	{ minutes: 5 },
	internal.events.syncToUnifiedEventStore
);

// convex/events.ts
export const syncToUnifiedEventStore = internalMutation({
	handler: async (ctx) => {
		const batchSize = 100;

		// Process unsynced auction events
		const unsyncedAuctionEvents = await ctx.db
			.query("auctionEvents")
			.filter((q) => q.neq(q.field("syncedToUnified"), true))
			.take(batchSize);

		for (const event of unsyncedAuctionEvents) {
			await ctx.db.insert("allEvents", {
				eventId: event.eventId,
				eventType: `auction.${event.eventType.replace("auction_", "")}`,
				aggregateType: "auction",
				aggregateId: event.auctionId,
				payload: event,
				userId: event.createdBy ?? "system",
				timestamp: event.timestamp,
				idempotencyKey: event.idempotencyKey,
				domainEventRef: `auctionEvents:${event._id}`,
				createdAt: Date.now(),
			});
			await ctx.db.patch(event._id, { syncedToUnified: true });
		}

		// Process unsynced bid events
		const unsyncedBidEvents = await ctx.db
			.query("bidEvents")
			.filter((q) => q.neq(q.field("syncedToUnified"), true))
			.take(batchSize);

		for (const event of unsyncedBidEvents) {
			await ctx.db.insert("allEvents", {
				eventId: event.eventId,
				eventType: `bid.${event.eventType.replace("bid_", "")}`,
				aggregateType: "bid",
				aggregateId: `${event.auctionId}:${event.materialId}`,
				payload: event,
				userId: event.bidderId,
				timestamp: event.timestamp,
				idempotencyKey: event.idempotencyKey,
				domainEventRef: `bidEvents:${event._id}`,
				createdAt: Date.now(),
			});
			await ctx.db.patch(event._id, { syncedToUnified: true });
		}

		// Similarly process materialEvents, auctionMaterialEvents, materialTemplateEvents...
	},
});
```

**Considerations:**

- **Async Processing**: Events are synced to unified store via scheduled function (eventual consistency)
- **No Dual Write Risk**: Domain tables are the source of truth; unified store is derived
- **Use Cases**:
  - Global event stream queries (all events across domains)
  - Cross-domain analytics and reporting
  - Event-driven integrations (webhooks, notifications)
  - Audit logs spanning multiple domains
  - Event replay for system-wide state reconstruction
- **Performance**: Batched processing prevents overwhelming the database
- **Idempotent**: `syncedToUnified` flag prevents duplicate syncing
- **Optional**: Can be added later if needed; domain tables remain primary source of truth

**Querying Domain Events from Unified Store:**

```typescript
// Parse and fetch domain event
const [tableName, eventId] = unifiedEvent.domainEventRef.split(":");
const domainEvent = await ctx.db.get(eventId as Id<typeof tableName>);
```

## Architecture Patterns

### Event Sourcing + CQRS (System-Wide)

**Why Event Sourcing for the Entire System?**

- **Immutability**: All entities (auctions, materials, bids, associations) are immutable by design
- **Full Audit Trail**: Complete history of all state changes for compliance and debugging
- **Time-Travel Queries**: Can query system state at any point in time
- **Rebuild Capability**: Aggregates can be rebuilt from event stream if needed
- **Consistency**: Uniform pattern across all domain entities
- **Event-Driven Architecture**: Natural fit for real-time updates and notifications

**Implementation Pattern:**

1. **Write Side (Command)**: All operations create events in event tables
   - `auctionEvents` for auction lifecycle
   - `materialEvents` for material lifecycle
   - `auctionMaterialEvents` for associations
   - `bidEvents` for bidding
   - `allEvents` (optional) for unified global event stream

2. **Read Side (Query)**: Query aggregate tables for current state
   - `auctionAggregates` for auction state
   - `materialAggregates` for material state
   - `auctionMaterialAggregates` for active associations
   - `bidAggregates` for bid statistics

3. **Projection**: Convex mutations update aggregates synchronously when events are created
   - Ensures consistency between events and aggregates
   - Can be rebuilt from events if aggregates become corrupted
   - **Dual Write**: If using unified event store, write to both domain table and `allEvents` in same transaction

**Example Flows:**

```text
Auction Creation:
  Admin creates auction
    → Validate input (dates, permissions)
    → Create auction_created event in auctionEvents
    → Update auctionAggregates (status: "draft")
    → Real-time subscription notifies admins

Material Approval:
  Admin approves material
    → Validate (admin role, material is pending)
    → Create material_approved event in materialEvents
    → Update materialAggregates (status: "approved")
    → Real-time subscription notifies seller

Bid Placement:
  User places bid
    → Validate bid (amount > current highest, auction is live)
    → Create bid_placed event in bidEvents
    → Update bidAggregates (highest bid, total bids, etc.)
    → Real-time subscription notifies other users

Template Usage:
  Seller creates material from template
    → Validate template (seller owns it, template is active)
    → Create material_created event in materialEvents (with templateId)
    → Create template_used event in materialTemplateEvents
    → Update materialAggregates (status: "pending")
    → Update materialTemplateAggregates (increment usageCount, update lastUsedAt)
    → Real-time subscription notifies seller
```

### Rebuilding Aggregates from Events

One of the key benefits of event sourcing is the ability to rebuild aggregates from the event stream:

**Use Cases:**

- **Data Migration**: When aggregate schema changes, rebuild from events
- **Bug Recovery**: If aggregate becomes corrupted, rebuild from events
- **New Aggregates**: Create new aggregate views from existing events
- **Audit Verification**: Verify aggregate state matches event history

**Implementation:**

```typescript
// convex/_util/rebuildAggregates.ts

// Rebuild auction aggregate from events
export async function rebuildAuctionAggregate(
	ctx: { db: DatabaseWriter },
	auctionId: string
): Promise<void> {
	const events = await ctx.db
		.query("auctionEvents")
		.withIndex("by_auction", (q) => q.eq("auctionId", auctionId))
		.order("asc")
		.collect();

	// Replay events to rebuild state
	let state = {
		auctionId,
		status: "draft" as const,
		// ... initial state
	};

	for (const event of events) {
		switch (event.eventType) {
			case "auction_created":
				state = { ...state, ...event, status: "draft" };
				break;
			case "auction_scheduled":
				state = { ...state, status: "scheduled" };
				break;
			case "auction_started":
				state = { ...state, status: "live" };
				break;
			case "auction_closed":
				state = { ...state, status: "closed" };
				break;
		}
	}

	// Update or create aggregate
	const existing = await ctx.db
		.query("auctionAggregates")
		.withIndex("by_auction", (q) => q.eq("auctionId", auctionId))
		.first();

	if (existing) {
		await ctx.db.patch(existing._id, { ...state, lastUpdated: Date.now() });
	} else {
		await ctx.db.insert("auctionAggregates", {
			...state,
			createdAt: Date.now(),
			lastUpdated: Date.now(),
		});
	}
}
```

### Material Approval Workflow

**States:**

- `pending`: Material uploaded, awaiting admin review
- `approved`: Admin approved, can be added to auctions
- `rejected`: Admin rejected (with optional reason)
- `archived`: Soft delete (preserve history)

**Admin Actions:**

- Approve material → status: `approved`, set `approvedBy`, `approvedAt`
- Reject material → status: `rejected`, set `rejectionReason`
- Archive material → status: `archived`

**Validation:**

- Only users with `admin` role can approve/reject
- Materials must be `approved` before appearing in auctions
- Rejected materials can be edited and resubmitted

## Technical Implementation

### 1. Effect-TS Service Layer

Following the existing `TasksService` pattern:

```typescript
// src/lib/effect/services/AuctionsService.ts
export class AuctionsService extends Context.Tag("AuctionsService")<
	AuctionsService,
	{
		// Auction management (admin only)
		createAuction: (input: CreateAuctionInput) => Effect.Effect<Id<"auctions">, AuctionsError>;
		updateAuction: (
			id: Id<"auctions">,
			updates: UpdateAuctionInput
		) => Effect.Effect<void, AuctionsError>;

		// Material management
		createMaterial: (input: CreateMaterialInput) => Effect.Effect<Id<"materials">, AuctionsError>;
		createMaterialFromTemplate: (
			templateId: string,
			quantity: NormalizedQuantity
		) => Effect.Effect<Id<"materials">, AuctionsError>;
		approveMaterial: (id: Id<"materials">) => Effect.Effect<void, AuctionsError>;
		rejectMaterial: (id: Id<"materials">, reason: string) => Effect.Effect<void, AuctionsError>;

		// Template management (seller only)
		createTemplate: (input: CreateTemplateInput) => Effect.Effect<string, AuctionsError>;
		createTemplateFromMaterial: (
			materialId: Id<"materials">,
			templateName: string
		) => Effect.Effect<string, AuctionsError>;
		updateTemplate: (
			templateId: string,
			updates: UpdateTemplateInput
		) => Effect.Effect<void, AuctionsError>;
		deleteTemplate: (templateId: string) => Effect.Effect<void, AuctionsError>;
		getTemplates: () => Effect.Effect<readonly Template[], AuctionsError>;
		getTemplate: (templateId: string) => Effect.Effect<Template, AuctionsError>;

		// Bidding
		placeBid: (
			input: PlaceBidInput,
			idempotencyKey?: string
		) => Effect.Effect<Id<"bidEvents">, AuctionsError>;
	}
>() {}
```

### 2. Effect Schema Validation

Client and server validation using Effect Schema:

```typescript
// src/lib/effect/services/AuctionsSchemas.ts

// Auction schemas
export const CreateAuctionInputSchema = Schema.Struct({
	title: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
	startDate: Schema.Number,
	endDate: Schema.Number,
	frequency: Schema.Union(
		Schema.Literal("weekly"),
		Schema.Literal("biweekly"),
		Schema.Literal("monthly"),
		Schema.Literal("custom")
	),
}).pipe(
	Schema.filter((input) => input.endDate > input.startDate, {
		message: () => "End date must be after start date",
	})
);

// Material schemas
// Note: Material type is determined by categories (e.g., categories in "Aluminum" group indicate aluminum materials)
export const CreateMaterialInputSchema = Schema.Struct({
	categoryIds: Schema.Array(Schema.String).pipe(
		Schema.minItems(1, { message: () => "At least one category is required" })
	),
	formIds: Schema.optional(Schema.Array(Schema.String)), // Array of form IDs
	finishIds: Schema.optional(Schema.Array(Schema.String)), // Array of finish IDs
	choiceIds: Schema.optional(Schema.Array(Schema.String)), // Array of choice IDs
	totalWeight: Schema.Number.pipe(
		Schema.greaterThan(0, { message: () => "Weight must be greater than 0" })
	),
	location: Schema.String.pipe(Schema.minLength(1, { message: () => "Location is required" })),
});

// Bid schemas
// Note: bidderId is NOT included in the input schema because it's determined server-side
// from the authenticated user session (identity.subject). This is a security best practice:
// - Prevents users from bidding as other users
// - The bidderId is extracted in the Convex mutation via getAuthenticatedUser(ctx)
// - Stored in bidEvents table as bidderId: identity.subject
// - Indexed by bidderId for efficient queries (user's bid history, contact info lookup)
export const PlaceBidInputSchema = Schema.Struct({
	auctionId: Schema.String.pipe(Schema.minLength(1)),
	materialId: Schema.String.pipe(Schema.minLength(1)),
	amount: Schema.Number.pipe(
		Schema.greaterThan(0, { message: () => "Bid amount must be greater than 0" })
	),
	idempotencyKey: Schema.optional(Schema.String),
});

// Template schemas
// Note: Templates have same structure as materials but exclude quantity
export const CreateTemplateInputSchema = Schema.Struct({
	templateName: Schema.String.pipe(
		Schema.minLength(1, { message: () => "Template name cannot be empty" }),
		Schema.maxLength(200, { message: () => "Template name cannot exceed 200 characters" })
	),
	categoryIds: Schema.Array(Schema.String).pipe(
		Schema.minItems(1, { message: () => "At least one category is required" })
	),
	formIds: Schema.optional(Schema.Array(Schema.String)), // Array of form IDs
	finishIds: Schema.optional(Schema.Array(Schema.String)), // Array of finish IDs
	choiceIds: Schema.optional(Schema.Array(Schema.String)), // Array of choice IDs
	attributes: Schema.optional(Schema.Any),
	location: Schema.String.pipe(Schema.minLength(1, { message: () => "Location is required" })),
});

export const UpdateTemplateInputSchema = CreateTemplateInputSchema.pipe(Schema.partial);

export const CreateMaterialFromTemplateInputSchema = Schema.Struct({
	templateId: Schema.String.pipe(Schema.minLength(1)),
	normalizedQuantity: Schema.Struct({
		quantity: Schema.Number.pipe(
			Schema.greaterThan(0, { message: () => "Quantity must be greater than 0" })
		),
		unit: Schema.String,
		baseUnit: Schema.String,
		baseQuantity: Schema.Number,
	}),
});
```

### 3. Material-Specific Validation & Pricing (Pluggable Architecture)

To support future expansion to construction materials, validation and pricing must be material-specific and pluggable:

**Material Validators:**

```typescript
// src/lib/effect/services/MaterialValidators.ts

// Base validator interface
export interface MaterialValidator {
	validate(attributes: Record<string, unknown>): Effect.Effect<void, ValidationError>;
	getRequiredFields(): string[];
}

// Steel-specific validator
export class SteelValidator implements MaterialValidator {
	validate(attributes: Record<string, unknown>): Effect.Effect<void, ValidationError> {
		return Effect.gen(function* () {
			// Validate steel-specific attributes
			if (!attributes.grade) {
				yield* Effect.fail(new ValidationError("Steel grade is required"));
			}
			if (attributes.thickness_mm && attributes.thickness_mm <= 0) {
				yield* Effect.fail(new ValidationError("Thickness must be positive"));
			}
		});
	}

	getRequiredFields(): string[] {
		return ["grade", "form"];
	}
}

// Concrete-specific validator (future)
export class ConcreteValidator implements MaterialValidator {
	validate(attributes: Record<string, unknown>): Effect.Effect<void, ValidationError> {
		return Effect.gen(function* () {
			if (!attributes.compressiveStrength_mpa) {
				yield* Effect.fail(new ValidationError("Compressive strength is required"));
			}
			if (attributes.compressiveStrength_mpa < 0) {
				yield* Effect.fail(new ValidationError("Compressive strength must be positive"));
			}
		});
	}

	getRequiredFields(): string[] {
		return ["compressiveStrength_mpa", "form"];
	}
}

// Validator factory
export function getMaterialValidator(materialType: string): MaterialValidator {
	switch (materialType) {
		case "steel":
			return new SteelValidator();
		case "concrete":
			return new ConcreteValidator();
		default:
			throw new Error(`Unknown material type: ${materialType}`);
	}
}
```

**Material Pricing Strategies:**

```typescript
// src/lib/effect/services/MaterialPricing.ts

// Base pricing strategy interface
export interface PricingStrategy {
	calculateBasePrice(quantity: NormalizedQuantity, attributes: Record<string, unknown>): number;
	getPriceUnit(): string; // e.g., "MXN/ton", "MXN/m3"
}

// Steel pricing: weight-based
export class SteelPricingStrategy implements PricingStrategy {
	calculateBasePrice(quantity: NormalizedQuantity, attributes: Record<string, unknown>): number {
		// Price per tonne based on grade, form, etc.
		const basePricePerTon = this.getBasePrice(attributes);
		return (quantity.baseQuantity / 1000) * basePricePerTon; // Convert kg to tonnes
	}

	getPriceUnit(): string {
		return "MXN/ton";
	}

	private getBasePrice(attributes: Record<string, unknown>): number {
		// Pricing logic based on steel attributes
		return 500; // Example
	}
}

// Concrete pricing: volume-based (future)
export class ConcretePricingStrategy implements PricingStrategy {
	calculateBasePrice(quantity: NormalizedQuantity, attributes: Record<string, unknown>): number {
		// Price per m³ based on strength, form, etc.
		const basePricePerM3 = this.getBasePrice(attributes);
		return quantity.baseQuantity * basePricePerM3;
	}

	getPriceUnit(): string {
		return "MXN/m3";
	}

	private getBasePrice(attributes: Record<string, unknown>): number {
		return 100; // Example
	}
}

// Pricing strategy factory
export function getPricingStrategy(materialType: string): PricingStrategy {
	switch (materialType) {
		case "steel":
			return new SteelPricingStrategy();
		case "concrete":
			return new ConcretePricingStrategy();
		default:
			throw new Error(`Unknown material type: ${materialType}`);
	}
}
```

**Benefits:**

- Auction logic remains material-agnostic
- New material types can be added by implementing new validators/strategies
- No changes to core auction, bidding, or event sourcing code
- Easy to test and maintain

### 4. Idempotency

**Bid Placement:**

- Use `idempotencyKey` in `bidEvents` table
- Index on `[bidderId, idempotencyKey]` to detect duplicates
- Client generates idempotency key (UUID) before bid submission
- Server checks for existing bid with same key before creating event

**Implementation:**

```typescript
// In Convex mutation
if (args.idempotencyKey) {
	const existing = await ctx.db
		.query("bidEvents")
		.withIndex("by_idempotency", (q) =>
			q.eq("bidderId", identity.subject).eq("idempotencyKey", args.idempotencyKey)
		)
		.first();

	if (existing) {
		return existing._id; // Return existing event (idempotent)
	}
}
```

### 4. Debouncing

**Bid Input:**

- Use `useDebounce` hook (already exists) for bid amount input
- Debounce validation, not submission
- Submit button should not be debounced (user intent is clear)

**Search/Filter:**

- Debounce filter inputs (categories, form, location, etc.)
- Prevents excessive queries while user types

### 5. Rate Limiting

**Bid Placement:**

- Limit bids per user per material (e.g., max 1 bid per 30 seconds)
- Limit total bids per user per auction (e.g., max 100 bids per auction)
- Implement in Convex mutation with timestamp checks

**Material Upload:**

- Limit material uploads per seller (e.g., max 10 per day)
- Prevent spam/abuse

**Implementation:**

```typescript
// In Convex mutation
const recentBids = await ctx.db
	.query("bidEvents")
	.withIndex("by_bidder", (q) => q.eq("bidderId", identity.subject))
	.filter((q) =>
		q.and(
			q.eq(q.field("materialId"), args.materialId),
			q.gt(q.field("timestamp"), Date.now() - 30000) // 30 seconds
		)
	)
	.collect();

if (recentBids.length > 0) {
	throw new Error("Rate limit: Please wait before placing another bid");
}
```

### 6. Client-Side Validation

Following TDR-0004 pattern (hybrid approach):

**Client (Effect Schema):**

- Immediate UX feedback
- Validates before API call
- Prevents unnecessary network requests

**Server (Convex):**

- Mirrors client validation rules
- Cannot be bypassed
- Defense in depth

**Shared Validation Constants:**

```typescript
// src/lib/effect/services/validation-constants.ts
export const VALIDATION_LIMITS = {
	MATERIAL_TITLE_MAX_LENGTH: 200,
	MATERIAL_WEIGHT_MIN: 0.001, // 1 kg minimum
	MATERIAL_WEIGHT_MAX: 100000, // 100k tonnes maximum
	BID_AMOUNT_MIN: 0.01, // 1 cent minimum
	BID_AMOUNT_MAX: 1000000, // 1M MXN per tonne maximum
	REJECTION_REASON_MAX_LENGTH: 500,
} as const;

// Supported currencies
export const SUPPORTED_CURRENCIES = ["MXN", "USD", "EUR"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
```

### 7. Error Type Taxonomy

Typed error definitions for the auctions domain, following Effect-TS patterns:

```typescript
// src/lib/effect/services/AuctionsErrors.ts
import { Data } from "effect";

// Base error class for auctions domain
export class AuctionsError extends Data.TaggedError("AuctionsError")<{
	readonly message: string;
}> {}

// Entity not found
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
	readonly entity: "auction" | "material" | "bid" | "template";
	readonly id: string;
}> {}

// Authorization failed
export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{
	readonly action: string;
	readonly requiredRole: "admin" | "seller" | "buyer";
}> {}

// Invalid state transition
export class InvalidStateError extends Data.TaggedError("InvalidStateError")<{
	readonly entity: string;
	readonly expected: string;
	readonly actual: string;
}> {}

// Validation failed
export class ValidationError extends Data.TaggedError("ValidationError")<{
	readonly field: string;
	readonly message: string;
}> {}

// Rate limit exceeded
export class RateLimitedError extends Data.TaggedError("RateLimitedError")<{
	readonly retryAfterMs: number;
}> {}

// Bid concurrency conflict (optimistic locking)
export class BidConflictError extends Data.TaggedError("BidConflictError")<{
	readonly expectedSequence: number;
	readonly actualSequence: number;
}> {}

// Auction not in live state
export class AuctionNotLiveError extends Data.TaggedError("AuctionNotLiveError")<{
	readonly auctionId: string;
	readonly status: string;
}> {}

// Bid amount too low
export class BidTooLowError extends Data.TaggedError("BidTooLowError")<{
	readonly currentHighest: number;
	readonly attempted: number;
}> {}

// Material not approved for auction
export class MaterialNotApprovedError extends Data.TaggedError("MaterialNotApprovedError")<{
	readonly materialId: string;
	readonly status: string;
}> {}

// Unsupported currency
export class UnsupportedCurrencyError extends Data.TaggedError("UnsupportedCurrencyError")<{
	readonly currency: string;
	readonly supportedCurrencies: readonly string[];
}> {}

// Union type for all auction errors
export type AuctionsDomainError =
	| NotFoundError
	| UnauthorizedError
	| InvalidStateError
	| ValidationError
	| RateLimitedError
	| BidConflictError
	| AuctionNotLiveError
	| BidTooLowError
	| MaterialNotApprovedError
	| UnsupportedCurrencyError;
```

**Usage in Mutations:**

```typescript
// Example: Using typed errors in placeBid mutation
import { Effect } from "effect";
import { BidConflictError, BidTooLowError, AuctionNotLiveError } from "./AuctionsErrors";

export const placeBidEffect = (args: PlaceBidArgs) =>
	Effect.gen(function* () {
		const auction = yield* getAuction(args.auctionId);

		if (auction.status !== "live") {
			return yield* Effect.fail(
				new AuctionNotLiveError({ auctionId: args.auctionId, status: auction.status })
			);
		}

		const aggregate = yield* getBidAggregate(args.auctionId, args.materialId);

		if (args.expectedSequence !== aggregate.currentSequence) {
			return yield* Effect.fail(
				new BidConflictError({
					expectedSequence: args.expectedSequence,
					actualSequence: aggregate.currentSequence,
				})
			);
		}

		if (args.amount <= aggregate.highestBidAmount) {
			return yield* Effect.fail(
				new BidTooLowError({
					currentHighest: aggregate.highestBidAmount,
					attempted: args.amount,
				})
			);
		}

		// ... proceed with bid placement
	});
```

## Convex Functions

### Queries

```typescript
// convex/auctions.ts

// Get active auctions (query aggregates)
export const getActiveAuctions = query({
	handler: async (ctx) => {
		const now = Date.now();
		return await ctx.db
			.query("auctionAggregates")
			.withIndex("by_status", (q) => q.eq("status", "live"))
			.filter((q) => q.and(q.lte(q.field("startDate"), now), q.gte(q.field("endDate"), now)))
			.collect();
	},
});

// Get materials for auction (approved only) - query aggregates
export const getAuctionMaterials = query({
	args: { auctionId: v.string() },
	handler: async (ctx, args) => {
		// Get active material associations for this auction
		const associations = await ctx.db
			.query("auctionMaterialAggregates")
			.withIndex("by_active_auction", (q) => q.eq("auctionId", args.auctionId).eq("isActive", true))
			.collect();

		// Fetch material aggregates (only approved)
		const materialIds = associations.map((a) => a.materialId);
		const materialDocs = await Promise.all(
			materialIds.map((id) =>
				ctx.db
					.query("materialAggregates")
					.withIndex("by_material", (q) => q.eq("materialId", id))
					.first()
					.then((m) => (m?.status === "approved" ? m : null))
			)
		);

		return materialDocs.filter(Boolean);
	},
});

// Get highest bid for material (query aggregates)
export const getHighestBid = query({
	args: {
		auctionId: v.string(),
		materialId: v.string(),
	},
	handler: async (ctx, args) => {
		const aggregate = await ctx.db
			.query("bidAggregates")
			.withIndex("by_auction_material", (q) =>
				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
			)
			.first();

		return aggregate;
	},
});

// Get all bids for a material (for admin/seller to contact bidders)
export const getMaterialBids = query({
	args: {
		auctionId: v.string(),
		materialId: v.string(),
	},
	handler: async (ctx, args) => {
		// Get all bid events for this material
		const bids = await ctx.db
			.query("bidEvents")
			.withIndex("by_auction_material", (q) =>
				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
			)
			.order("desc") // Most recent first
			.collect();

		return bids.map((bid) => ({
			bidderId: bid.bidderId, // WorkOS user ID (identity.subject)
			amount: bid.amount,
			currency: bid.currency,
			timestamp: bid.timestamp,
			// Note: To get bidder contact info (email, name), query WorkOS API:
			// const user = await workosClient.userManagement.getUser(bid.bidderId);
			// Returns: { email, firstName, lastName, ... }
		}));
	},
});

// Get bidder information (requires WorkOS API call - not a Convex query)
// This would be implemented as a Convex action or server function
// Example:
// export const getBidderInfo = action({
//   args: { bidderId: v.string() },
//   handler: async (ctx, args) => {
//     // Call WorkOS API to get user details
//     const user = await workosClient.userManagement.getUser(args.bidderId);
//     return {
//       email: user.email,
//       firstName: user.firstName,
//       lastName: user.lastName,
//       // ... other contact info
//     };
//   },
// });
```

### Mutations

```typescript
// convex/auctions.ts

// Create auction (admin only) - Event-driven
// Uses Convex's built-in _id for identification (no custom ID generation)
export const createAuction = mutation({
	args: {
		title: v.optional(v.string()),
		startDate: v.number(),
		endDate: v.number(),
		frequency: v.union(
			v.literal("weekly"),
			v.literal("biweekly"),
			v.literal("monthly"),
			v.literal("custom")
		),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		await requireAdminRole(ctx, identity.subject);

		// Server-side validation
		if (args.endDate <= args.startDate) {
			throw new Error("End date must be after start date");
		}

		// Validate: Check if there's already a live auction (single active auction constraint)
		// Note: This prevents manual creation of auctions when one is already live
		// Scheduled auctions created automatically when previous auction closes are exempt
		const { validateSingleLiveAuction } = await import("./_util/auctions");
		await validateSingleLiveAuction(ctx);

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create aggregate first to get the _id
		const auctionId = await ctx.db.insert("auctionAggregates", {
			title: args.title,
			startDate: args.startDate,
			endDate: args.endDate,
			frequency: args.frequency,
			status: "draft",
			createdBy: identity.subject,
			createdAt: now,
			lastEventId: eventId,
			lastUpdated: now,
		});

		// Check idempotency using the new auctionId
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("auctionEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("auctionId", auctionId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				// Delete the aggregate we just created and return existing
				await ctx.db.delete(auctionId);
				return existing.auctionId;
			}
		}

		// Create auction_created event (domain-specific table)
		// Note: Unified event store is synced asynchronously via scheduled function
		await ctx.db.insert("auctionEvents", {
			eventId,
			eventType: "auction_created",
			auctionId, // Uses Convex's built-in _id from auctionAggregates
			title: args.title,
			startDate: args.startDate,
			endDate: args.endDate,
			frequency: args.frequency,
			createdBy: identity.subject,
			schemaVersion: 1,
			syncedToUnified: false, // Will be synced by scheduled function
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		return auctionId; // Returns Convex's built-in _id
	},
});

// Place bid (with idempotency, rate limiting, and concurrency control) - Event-driven
export const placeBid = mutation({
	args: {
		auctionId: v.id("auctionAggregates"),
		materialId: v.id("materialAggregates"),
		amount: v.number(),
		currency: v.string(), // "MXN", "USD", "EUR" etc.
		expectedSequence: v.number(), // For optimistic concurrency control
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);

		// Server-side validation
		if (args.amount <= 0) {
			throw new Error("Bid amount must be greater than 0");
		}

		// Validate currency
		const SUPPORTED_CURRENCIES = ["MXN", "USD", "EUR"] as const;
		if (!SUPPORTED_CURRENCIES.includes(args.currency as (typeof SUPPORTED_CURRENCIES)[number])) {
			throw new Error(`Unsupported currency: ${args.currency}`);
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("bidEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("bidderId", identity.subject).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return existing._id; // Idempotent return
			}
		}

		// Rate limiting: Check recent bids using indexed query + pagination
		// Query by bidder and timestamp, then filter by material client-side
		const thirtySecondsAgo = Date.now() - 30000;
		const recentBidsPage = await ctx.db
			.query("bidEvents")
			.withIndex("by_bidder_timestamp", (q) =>
				q.eq("bidderId", identity.subject).gt("timestamp", thirtySecondsAgo)
			)
			.order("desc")
			.take(100); // Paginate to limit scan

		// Filter by materialId client-side
		const recentBidsForMaterial = recentBidsPage.filter(
			(bid) => bid.materialId === args.materialId
		);

		if (recentBidsForMaterial.length > 0) {
			throw new Error("Rate limit: Please wait before placing another bid");
		}

		// Check auction is live (query by _id directly)
		const auction = await ctx.db.get(args.auctionId);

		if (!auction || auction.status !== "live") {
			throw new Error("Auction is not active");
		}

		// Validate: Ensure this is the only live auction (single active auction constraint)
		const { validateSingleLiveAuction } = await import("./_util/auctions");
		await validateSingleLiveAuction(ctx, args.auctionId);

		// Check current highest bid and validate sequence for concurrency control
		const aggregate = await ctx.db
			.query("bidAggregates")
			.withIndex("by_auction_material", (q) =>
				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
			)
			.first();

		// Optimistic concurrency control: validate sequence number
		const currentSequence = aggregate?.currentSequence ?? 0;
		if (args.expectedSequence !== currentSequence) {
			throw new Error(
				`Bid conflict: another bid was placed. Expected sequence ${args.expectedSequence}, current is ${currentSequence}. Please retry.`
			);
		}

		if (aggregate && args.amount <= aggregate.highestBidAmount) {
			throw new Error("Bid must be higher than current highest bid");
		}

		const now = Date.now();
		const newSequence = currentSequence + 1;

		// Create bid event with sequence number
		const eventId = await ctx.db.insert("bidEvents", {
			eventId: crypto.randomUUID(),
			eventType: "bid_placed",
			auctionId: args.auctionId,
			materialId: args.materialId,
			bidderId: identity.subject,
			amount: args.amount,
			currency: args.currency,
			sequenceNumber: newSequence,
			schemaVersion: 1,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Update aggregate (or create if doesn't exist) with new sequence
		if (aggregate) {
			await ctx.db.patch(aggregate._id, {
				highestBidAmount: args.amount,
				highestBidderId: identity.subject,
				highestBidEventId: eventId,
				highestBidTimestamp: now,
				currentSequence: newSequence,
				totalBids: aggregate.totalBids + 1,
				uniqueBidders:
					aggregate.uniqueBidders + (aggregate.highestBidderId === identity.subject ? 0 : 1),
				lastUpdated: now,
			});
		} else {
			await ctx.db.insert("bidAggregates", {
				auctionId: args.auctionId,
				materialId: args.materialId,
				highestBidAmount: args.amount,
				highestBidderId: identity.subject,
				highestBidEventId: eventId,
				highestBidTimestamp: now,
				currentSequence: newSequence,
				totalBids: 1,
				uniqueBidders: 1,
				lastUpdated: now,
			});
		}

		return eventId;
	},
});

// Close auction (admin only, or automatic) - Event-driven
// When an auction closes, automatically creates the next scheduled auction
export const closeAuction = mutation({
	args: {
		auctionId: v.string(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		// Note: Can be called by admin manually, or by scheduled function automatically
		// If called by scheduled function, identity will be system user

		// Get current auction aggregate
		const auction = await ctx.db
			.query("auctionAggregates")
			.withIndex("by_auction", (q) => q.eq("auctionId", args.auctionId))
			.first();

		if (!auction) {
			throw new Error("Auction not found");
		}

		if (auction.status !== "live") {
			throw new Error("Auction is not live");
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("auctionEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("auctionId", args.auctionId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return existing._id; // Idempotent return
			}
		}

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create auction_closed event
		await ctx.db.insert("auctionEvents", {
			eventId,
			eventType: "auction_closed",
			auctionId: args.auctionId,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Update aggregate
		await ctx.db.patch(auction._id, {
			status: "closed",
			lastEventId: eventId,
			lastUpdated: now,
		});

		// Automatically create next scheduled auction based on frequency
		const { calculateNextAuctionDates } = await import("./_util/auctions");
		const nextAuctionDates = calculateNextAuctionDates(
			auction.startDate,
			auction.endDate,
			auction.frequency
		);

		const nextAuctionId = generateAuctionId(auction.createdBy);
		const nextEventId = crypto.randomUUID();

		// Create next auction_created event
		await ctx.db.insert("auctionEvents", {
			eventId: nextEventId,
			eventType: "auction_created",
			auctionId: nextAuctionId,
			title: auction.title,
			startDate: nextAuctionDates.startDate,
			endDate: nextAuctionDates.endDate,
			frequency: auction.frequency,
			createdBy: auction.createdBy,
			timestamp: now,
			createdAt: now,
		});

		// Create next auction_scheduled event
		const scheduledEventId = crypto.randomUUID();
		await ctx.db.insert("auctionEvents", {
			eventId: scheduledEventId,
			eventType: "auction_scheduled",
			auctionId: nextAuctionId,
			timestamp: now,
			createdAt: now,
		});

		// Update/create next auction aggregate (status: "scheduled")
		await ctx.db.insert("auctionAggregates", {
			auctionId: nextAuctionId,
			title: auction.title,
			startDate: nextAuctionDates.startDate,
			endDate: nextAuctionDates.endDate,
			frequency: auction.frequency,
			status: "scheduled",
			createdBy: auction.createdBy,
			createdAt: now,
			lastEventId: scheduledEventId,
			lastUpdated: now,
		});

		return eventId;
	},
});

// Approve material (admin only) - Event-driven
export const approveMaterial = mutation({
	args: {
		materialId: v.string(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		await requireAdminRole(ctx, identity.subject);

		// Check current aggregate state
		const aggregate = await ctx.db
			.query("materialAggregates")
			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
			.first();

		if (!aggregate) {
			throw new Error("Material not found");
		}

		if (aggregate.status !== "pending") {
			throw new Error("Material is not pending approval");
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("materialEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("materialId", args.materialId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return existing._id; // Idempotent return
			}
		}

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create material_approved event
		await ctx.db.insert("materialEvents", {
			eventId,
			eventType: "material_approved",
			materialId: args.materialId,
			approvedBy: identity.subject,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Update aggregate
		await ctx.db.patch(aggregate._id, {
			status: "approved",
			approvedBy: identity.subject,
			approvedAt: now,
			lastEventId: eventId,
			lastUpdated: now,
		});
	},
});
```

### Scheduled Functions (Crons)

Convex uses a dedicated `crons.ts` file for scheduled functions:

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Activate scheduled auctions when start date matches Mexico City time
// Runs every 30 minutes to check for auctions that should be activated
crons.interval(
	"activate scheduled auctions",
	{ minutes: 30 },
	internal.auctions.activateScheduledAuctions
);

// Close auctions when end date passes
// Runs every 30 minutes to check for auctions that should be closed
crons.interval("close expired auctions", { minutes: 30 }, internal.auctions.closeExpiredAuctions);

export default crons;
```

The internal mutation handlers are defined separately:

```typescript
// convex/auctions.ts

import { internalMutation } from "./_generated/server";
import { getMexicoCityTime, validateSingleLiveAuction } from "./_util/auctions";

// Internal mutation: Activate scheduled auctions when start date matches Mexico City time
export const activateScheduledAuctions = internalMutation({
	handler: async (ctx) => {
		const mexicoCityNow = getMexicoCityTime();
		const tolerance = 30 * 60 * 1000; // 30 minute tolerance (matches cron interval)

		// Find all scheduled auctions whose start date is within the tolerance window
		const scheduledAuctions = await ctx.db
			.query("auctionAggregates")
			.withIndex("by_status", (q) => q.eq("status", "scheduled"))
			.filter((q) => {
				const startDate = q.field("startDate");
				// Start date is within tolerance: [now - tolerance, now + tolerance]
				return q.and(
					q.gte(startDate, mexicoCityNow - tolerance),
					q.lte(startDate, mexicoCityNow + tolerance)
				);
			})
			.collect();

		// Ensure only one auction can be active at a time
		// First, check if there's already a live auction
		const existingLiveAuction = await ctx.db
			.query("auctionAggregates")
			.withIndex("by_status", (q) => q.eq("status", "live"))
			.first();

		if (existingLiveAuction) {
			// If there's already a live auction, close it first
			// This ensures only the latest auction is active
			await ctx.scheduler.runAfter(0, internal.auctions.closeAuction, {
				auctionId: existingLiveAuction._id,
			});
		}

		// Activate the scheduled auction(s) - should only be one due to constraint
		for (const auction of scheduledAuctions) {
			// Validate: Only activate if no other live auction exists
			// Use helper function to enforce single active auction constraint
			try {
				await validateSingleLiveAuction(ctx, auction._id);
			} catch (error) {
				console.warn(
					`Cannot activate auction ${auction._id}: ${error instanceof Error ? error.message : "Another live auction exists"}`
				);
				continue;
			}

			const now = Date.now();
			const eventId = crypto.randomUUID();

			// Create auction_started event
			await ctx.db.insert("auctionEvents", {
				eventId,
				eventType: "auction_started",
				auctionId: auction._id,
				timestamp: now,
				createdAt: now,
			});

			// Update aggregate to "live"
			await ctx.db.patch(auction._id, {
				status: "live",
				lastEventId: eventId,
				lastUpdated: now,
			});
		}
	},
});

// Internal mutation: Close auctions when end date passes
export const closeExpiredAuctions = internalMutation({
	handler: async (ctx) => {
		const mexicoCityNow = getMexicoCityTime();

		// Find all live auctions whose end date has passed
		const expiredAuctions = await ctx.db
			.query("auctionAggregates")
			.withIndex("by_status", (q) => q.eq("status", "live"))
			.filter((q) => q.lte(q.field("endDate"), mexicoCityNow))
			.collect();

		// Close expired auctions (this will automatically create next scheduled auction)
		for (const auction of expiredAuctions) {
			await ctx.scheduler.runAfter(0, internal.auctions.closeAuction, {
				auctionId: auction._id,
			});
		}
	},
});
```

### Template Queries

```typescript
// convex/templates.ts

// Get all templates for authenticated seller
export const getTemplates = query({
	handler: async (ctx) => {
		const identity = await getAuthenticatedUser(ctx);
		return await ctx.db
			.query("materialTemplateAggregates")
			.withIndex("by_seller_status", (q) =>
				q.eq("sellerId", identity.subject).eq("status", "active")
			)
			.order("desc")
			.collect();
	},
});

// Get single template by ID (seller must own it)
export const getTemplate = query({
	args: { templateId: v.string() },
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		const template = await ctx.db
			.query("materialTemplateAggregates")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.first();

		if (!template) {
			throw new Error("Template not found");
		}

		if (template.sellerId !== identity.subject) {
			throw new Error("Unauthorized: Template belongs to another seller");
		}

		return template;
	},
});
```

### Template Mutations

```typescript
// convex/templates.ts

// Create template from scratch
export const createTemplate = mutation({
	args: {
		templateName: v.string(),
		categoryIds: v.array(v.id("categories")),
		formIds: v.optional(v.array(v.id("forms"))),
		finishIds: v.optional(v.array(v.id("finishes"))),
		choiceIds: v.optional(v.array(v.id("choices"))),
		attributes: v.optional(v.any()),
		location: v.string(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		await requireSellerRole(ctx, identity.subject);

		// Server-side validation
		if (args.templateName.trim().length === 0) {
			throw new Error("Template name cannot be empty");
		}
		if (args.categoryIds.length === 0) {
			throw new Error("At least one category is required");
		}

		// Generate template ID
		const templateId = generateTemplateId(identity.subject);

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("materialTemplateEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("templateId", templateId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return existing.templateId; // Idempotent return
			}
		}

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create template_created event
		await ctx.db.insert("materialTemplateEvents", {
			eventId,
			eventType: "template_created",
			templateId,
			templateName: args.templateName,
			categoryIds: args.categoryIds,
			formIds: args.formIds,
			finishIds: args.finishIds,
			choiceIds: args.choiceIds,
			attributes: args.attributes,
			location: args.location,
			sellerId: identity.subject,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Update aggregate
		await ctx.db.insert("materialTemplateAggregates", {
			templateId,
			templateName: args.templateName,
			categoryIds: args.categoryIds,
			attributes: args.attributes,
			location: args.location,
			sellerId: identity.subject,
			usageCount: 0,
			status: "active",
			createdAt: now,
			lastEventId: eventId,
			lastUpdated: now,
		});

		// Populate junction tables in parallel (still atomic in Convex transactions)
		await Promise.all([
			...(args.formIds ?? []).map((formId) =>
				ctx.db.insert("templateForms", { templateId, formId, createdAt: now })
			),
			...(args.finishIds ?? []).map((finishId) =>
				ctx.db.insert("templateFinishes", { templateId, finishId, createdAt: now })
			),
			...(args.choiceIds ?? []).map((choiceId) =>
				ctx.db.insert("templateChoices", { templateId, choiceId, createdAt: now })
			),
		]);

		return templateId;
	},
});

// Create template from existing material
export const createTemplateFromMaterial = mutation({
	args: {
		materialId: v.string(),
		templateName: v.string(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		await requireSellerRole(ctx, identity.subject);

		// Get material aggregate
		const material = await ctx.db
			.query("materialAggregates")
			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
			.first();

		if (!material) {
			throw new Error("Material not found");
		}

		if (material.sellerId !== identity.subject) {
			throw new Error("Unauthorized: Material belongs to another seller");
		}

		// Get material categories
		const categories = await ctx.db
			.query("materialCategories")
			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
			.collect();

		const categoryIds = categories.map((c) => c.categoryId);

		// Get material forms
		const forms = await ctx.db
			.query("materialForms")
			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
			.collect();

		const formIds = forms.map((f) => f.formId);

		// Get material finishes
		const finishes = await ctx.db
			.query("materialFinishes")
			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
			.collect();

		const finishIds = finishes.map((f) => f.finishId);

		// Get material choices
		const choices = await ctx.db
			.query("materialChoices")
			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
			.collect();

		const choiceIds = choices.map((c) => c.choiceId);

		// Generate template ID
		const templateId = generateTemplateId(identity.subject);

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("materialTemplateEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("templateId", templateId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return existing.templateId; // Idempotent return
			}
		}

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create template_created event
		await ctx.db.insert("materialTemplateEvents", {
			eventId,
			eventType: "template_created",
			templateId,
			templateName: args.templateName,
			categoryIds,
			formIds,
			finishIds,
			choiceIds,
			attributes: material.attributes,
			location: material.location,
			sellerId: identity.subject,
			sourceMaterialId: args.materialId,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Update aggregate
		await ctx.db.insert("materialTemplateAggregates", {
			templateId,
			templateName: args.templateName,
			categoryIds,
			attributes: material.attributes,
			location: material.location,
			sellerId: identity.subject,
			sourceMaterialId: args.materialId,
			usageCount: 0,
			status: "active",
			createdAt: now,
			lastEventId: eventId,
			lastUpdated: now,
		});

		// Populate template junction tables in parallel (still atomic in Convex transactions)
		await Promise.all([
			...formIds.map((formId) =>
				ctx.db.insert("templateForms", { templateId, formId, createdAt: now })
			),
			...finishIds.map((finishId) =>
				ctx.db.insert("templateFinishes", { templateId, finishId, createdAt: now })
			),
			...choiceIds.map((choiceId) =>
				ctx.db.insert("templateChoices", { templateId, choiceId, createdAt: now })
			),
		]);

		return templateId;
	},
});

// Create material from template
export const createMaterialFromTemplate = mutation({
	args: {
		templateId: v.string(),
		normalizedQuantity: v.object({
			quantity: v.number(),
			unit: v.string(),
			baseUnit: v.string(),
			baseQuantity: v.number(),
		}),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		await requireSellerRole(ctx, identity.subject);

		// Get template aggregate
		const template = await ctx.db
			.query("materialTemplateAggregates")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.first();

		if (!template) {
			throw new Error("Template not found");
		}

		if (template.sellerId !== identity.subject) {
			throw new Error("Unauthorized: Template belongs to another seller");
		}

		if (template.status !== "active") {
			throw new Error("Template is not active");
		}

		// Validate quantity
		if (args.normalizedQuantity.quantity <= 0) {
			throw new Error("Quantity must be greater than 0");
		}

		// Get template forms, finishes, and choices from junction tables
		const templateForms = await ctx.db
			.query("templateForms")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.collect();

		const formIds = templateForms.map((f) => f.formId);

		const templateFinishes = await ctx.db
			.query("templateFinishes")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.collect();

		const finishIds = templateFinishes.map((f) => f.finishId);

		const templateChoices = await ctx.db
			.query("templateChoices")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.collect();

		const choiceIds = templateChoices.map((c) => c.choiceId);

		// Generate material ID
		const materialId = generateMaterialId(identity.subject);

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("materialEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("materialId", materialId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return existing.materialId; // Idempotent return
			}
		}

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create material_created event (from template)
		await ctx.db.insert("materialEvents", {
			eventId,
			eventType: "material_created",
			materialId,
			categoryIds: template.categoryIds,
			formIds,
			finishIds,
			choiceIds,
			normalizedQuantity: args.normalizedQuantity,
			attributes: template.attributes,
			location: template.location,
			sellerId: identity.subject,
			templateId: args.templateId,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Create template_used event
		const templateEventId = crypto.randomUUID();
		await ctx.db.insert("materialTemplateEvents", {
			eventId: templateEventId,
			eventType: "template_used",
			templateId: args.templateId,
			sellerId: identity.subject,
			materialId,
			timestamp: now,
			createdAt: now,
		});

		// Update material aggregate
		await ctx.db.insert("materialAggregates", {
			materialId,
			categoryIds: template.categoryIds,
			normalizedQuantity: args.normalizedQuantity,
			attributes: template.attributes,
			location: template.location,
			sellerId: identity.subject,
			templateId: args.templateId,
			searchableText: generateSearchableText(template, args.normalizedQuantity),
			status: "pending",
			createdAt: now,
			lastEventId: eventId,
			lastUpdated: now,
		});

		// Update template aggregate (increment usage count)
		await ctx.db.patch(template._id, {
			usageCount: template.usageCount + 1,
			lastUsedAt: now,
			lastEventId: templateEventId,
			lastUpdated: now,
		});

		// Populate material junction tables in parallel (still atomic in Convex transactions)
		await Promise.all([
			...template.categoryIds.map((categoryId) =>
				ctx.db.insert("materialCategories", { materialId, categoryId, createdAt: now })
			),
			...formIds.map((formId) =>
				ctx.db.insert("materialForms", { materialId, formId, createdAt: now })
			),
			...finishIds.map((finishId) =>
				ctx.db.insert("materialFinishes", { materialId, finishId, createdAt: now })
			),
			...choiceIds.map((choiceId) =>
				ctx.db.insert("materialChoices", { materialId, choiceId, createdAt: now })
			),
		]);

		return materialId;
	},
});

// Update template
export const updateTemplate = mutation({
	args: {
		templateId: v.string(),
		templateName: v.optional(v.string()),
		categoryIds: v.optional(v.array(v.id("categories"))),
		formIds: v.optional(v.array(v.id("forms"))),
		finishIds: v.optional(v.array(v.id("finishes"))),
		choiceIds: v.optional(v.array(v.id("choices"))),
		attributes: v.optional(v.any()),
		location: v.optional(v.string()),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		await requireSellerRole(ctx, identity.subject);

		// Get template aggregate
		const template = await ctx.db
			.query("materialTemplateAggregates")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.first();

		if (!template) {
			throw new Error("Template not found");
		}

		if (template.sellerId !== identity.subject) {
			throw new Error("Unauthorized: Template belongs to another seller");
		}

		if (template.status !== "active") {
			throw new Error("Template is not active");
		}

		// Get current form/finish/choice IDs from junction tables
		const currentForms = await ctx.db
			.query("templateForms")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.collect();

		const currentFormIds = currentForms.map((f) => f.formId);

		const currentFinishes = await ctx.db
			.query("templateFinishes")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.collect();

		const currentFinishIds = currentFinishes.map((f) => f.finishId);

		const currentChoices = await ctx.db
			.query("templateChoices")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.collect();

		const currentChoiceIds = currentChoices.map((c) => c.choiceId);

		// Determine new IDs (use provided or keep current)
		const newFormIds = args.formIds ?? currentFormIds;
		const newFinishIds = args.finishIds ?? currentFinishIds;
		const newChoiceIds = args.choiceIds ?? currentChoiceIds;

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("materialTemplateEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("templateId", args.templateId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return; // Idempotent return
			}
		}

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create template_updated event
		await ctx.db.insert("materialTemplateEvents", {
			eventId,
			eventType: "template_updated",
			templateId: args.templateId,
			templateName: args.templateName ?? template.templateName,
			categoryIds: args.categoryIds ?? template.categoryIds,
			formIds: newFormIds,
			finishIds: newFinishIds,
			choiceIds: newChoiceIds,
			attributes: args.attributes ?? template.attributes,
			location: args.location ?? template.location,
			sellerId: identity.subject,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Update aggregate
		await ctx.db.patch(template._id, {
			templateName: args.templateName ?? template.templateName,
			categoryIds: args.categoryIds ?? template.categoryIds,
			attributes: args.attributes ?? template.attributes,
			location: args.location ?? template.location,
			lastEventId: eventId,
			lastUpdated: now,
		});

		// Update junction tables in parallel (delete old, insert new - still atomic in Convex)
		await Promise.all([
			// Delete old associations if updating
			...(args.formIds !== undefined ? currentForms.map((f) => ctx.db.delete(f._id)) : []),
			...(args.finishIds !== undefined ? currentFinishes.map((f) => ctx.db.delete(f._id)) : []),
			...(args.choiceIds !== undefined ? currentChoices.map((c) => ctx.db.delete(c._id)) : []),
		]);

		// Insert new associations in parallel
		await Promise.all([
			...(args.formIds !== undefined
				? newFormIds.map((formId) =>
						ctx.db.insert("templateForms", { templateId: args.templateId, formId, createdAt: now })
					)
				: []),
			...(args.finishIds !== undefined
				? newFinishIds.map((finishId) =>
						ctx.db.insert("templateFinishes", {
							templateId: args.templateId,
							finishId,
							createdAt: now,
						})
					)
				: []),
			...(args.choiceIds !== undefined
				? newChoiceIds.map((choiceId) =>
						ctx.db.insert("templateChoices", {
							templateId: args.templateId,
							choiceId,
							createdAt: now,
						})
					)
				: []),
		]);
	},
});

// Delete template (soft delete)
export const deleteTemplate = mutation({
	args: {
		templateId: v.string(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		await requireSellerRole(ctx, identity.subject);

		// Get template aggregate
		const template = await ctx.db
			.query("materialTemplateAggregates")
			.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
			.first();

		if (!template) {
			throw new Error("Template not found");
		}

		if (template.sellerId !== identity.subject) {
			throw new Error("Unauthorized: Template belongs to another seller");
		}

		if (template.status === "deleted") {
			return; // Already deleted
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("materialTemplateEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("templateId", args.templateId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return; // Idempotent return
			}
		}

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create template_deleted event
		await ctx.db.insert("materialTemplateEvents", {
			eventId,
			eventType: "template_deleted",
			templateId: args.templateId,
			sellerId: identity.subject,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Update aggregate (soft delete)
		await ctx.db.patch(template._id, {
			status: "deleted",
			lastEventId: eventId,
			lastUpdated: now,
		});
	},
});
```

### Helper Functions

```typescript
// convex/_util/roles.ts

export async function requireAdminRole(ctx: { db: DatabaseWriter }, userId: string): Promise<void> {
	const userRole = await ctx.db
		.query("userRoles")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	if (!userRole || !userRole.roles.includes("admin")) {
		throw new Error("Admin role required");
	}
}

export async function hasRole(
	ctx: { db: DatabaseReader },
	userId: string,
	role: "admin" | "seller" | "buyer"
): Promise<boolean> {
	const userRole = await ctx.db
		.query("userRoles")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	return userRole?.roles.includes(role) ?? false;
}

export async function requireSellerRole(
	ctx: { db: DatabaseWriter },
	userId: string
): Promise<void> {
	const userRole = await ctx.db
		.query("userRoles")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	if (!userRole || !userRole.roles.includes("seller")) {
		throw new Error("Seller role required");
	}
}
```

```typescript
// convex/_util/auctions.ts

/**
 * Get current time in Mexico City timezone.
 * Mexico City is UTC-6 (CST) or UTC-5 (CDT) depending on DST.
 * In production, use a proper timezone library like date-fns-tz or luxon.
 */
export function getMexicoCityTime(): number {
	const now = new Date();
	// Simplified: Mexico City is UTC-6 (adjust for DST if needed)
	// For production, use: import { zonedTimeToUtc } from "date-fns-tz";
	const mexicoCityOffset = -6 * 60; // UTC-6 in minutes
	const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
	return utcTime + mexicoCityOffset * 60000;
}

/**
 * Calculate next auction dates based on frequency.
 * Used when automatically creating the next scheduled auction after one closes.
 */
export function calculateNextAuctionDates(
	previousStartDate: number,
	previousEndDate: number,
	frequency: "weekly" | "biweekly" | "monthly" | "custom"
): { startDate: number; endDate: number } {
	const duration = previousEndDate - previousStartDate;
	let nextStartDate: number;

	switch (frequency) {
		case "weekly":
			nextStartDate = previousEndDate + 1; // Next auction starts 1ms after previous ends
			break;
		case "biweekly":
			nextStartDate = previousEndDate + 14 * 24 * 60 * 60 * 1000; // 14 days later
			break;
		case "monthly":
			nextStartDate = previousEndDate + 30 * 24 * 60 * 60 * 1000; // 30 days later (simplified)
			break;
		case "custom":
			// For custom, use same interval as previous auction
			nextStartDate = previousEndDate + 1;
			break;
	}

	return {
		startDate: nextStartDate,
		endDate: nextStartDate + duration,
	};
}

/**
 * Note: Auction IDs use Convex's built-in _id field (auto-generated UUID).
 * No custom ID generation is needed - Convex handles this automatically.
 * The _id field provides guaranteed uniqueness and is indexed by default.
 */

/**
 * Validate that only one auction can be live at a time.
 * Throws an error if another live auction exists.
 * Uses Convex's built-in _id field for identification.
 */
export async function validateSingleLiveAuction(
	ctx: { db: DatabaseReader },
	excludeAuctionId?: Id<"auctionAggregates">
): Promise<void> {
	const query = ctx.db
		.query("auctionAggregates")
		.withIndex("by_status", (q) => q.eq("status", "live"));

	const liveAuctions = excludeAuctionId
		? await query.filter((q) => q.neq(q.field("_id"), excludeAuctionId)).collect()
		: await query.collect();

	if (liveAuctions.length > 0) {
		const otherAuctionIds = liveAuctions.map((a) => a._id).join(", ");
		throw new Error(
			`Only one auction can be active at a time. Other live auction(s): ${otherAuctionIds}`
		);
	}
}
```

### Unified Event Store Queries

If using the unified event store, here are example queries for global event stream access:

```typescript
// convex/events.ts

// Get all events for a specific aggregate (cross-domain)
export const getAggregateEvents = query({
	args: {
		aggregateType: v.union(
			v.literal("auction"),
			v.literal("material"),
			v.literal("auctionMaterial"),
			v.literal("bid")
		),
		aggregateId: v.string(),
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("allEvents")
			.withIndex("by_aggregate", (q) =>
				q.eq("aggregateType", args.aggregateType).eq("aggregateId", args.aggregateId)
			)
			.order("asc")
			.collect();
	},
});

// Get all events by user (activity feed)
export const getUserEvents = query({
	args: {
		userId: v.string(),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const events = await ctx.db
			.query("allEvents")
			.withIndex("by_user", (q) => q.eq("metadata.userId", args.userId))
			.order("desc")
			.take(args.limit ?? 50);

		return events;
	},
});

// Get recent events across all domains (global activity feed)
export const getRecentEvents = query({
	args: {
		limit: v.optional(v.number()),
		since: v.optional(v.number()), // Unix timestamp
	},
	handler: async (ctx, args) => {
		let query = ctx.db.query("allEvents").withIndex("by_timestamp", (q) => q.order("desc"));

		if (args.since) {
			query = query.filter((q) => q.gte(q.field("metadata.timestamp"), args.since!));
		}

		return await query.take(args.limit ?? 100);
	},
});

// Get events by type (e.g., all bid.placed events)
export const getEventsByType = query({
	args: {
		eventType: v.string(), // e.g., "bid.placed", "auction.created"
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("allEvents")
			.withIndex("by_event_type", (q) => q.eq("eventType", args.eventType))
			.order("desc")
			.take(args.limit ?? 100);
	},
});
```

**When to Use Unified Event Store vs Domain Tables:**

- **Use Domain Tables** (`auctionEvents`, `bidEvents`, etc.) for:
  - Domain-specific queries (all bids for a material)
  - Type-safe queries with domain-specific fields
  - Performance-critical queries (indexed by domain)

- **Use Unified Event Store** (`allEvents`) for:
  - Cross-domain analytics and reporting
  - Global activity feeds
  - Event-driven integrations (webhooks, notifications)
  - Audit logs spanning multiple domains
  - User activity tracking across all domains

## UI Components

### Live Auctions Page

Based on the provided images, the UI should include:

1. **Filters**
   - Categories (multi-select)
   - Form (multi-select)
   - Choice (multi-select)
   - Seller (dropdown)
   - Location (dropdown)
   - Tag (multi-select: "New this week", "Price reduction", "Green Steel")

2. **View Toggle**
   - Auction View (default)
   - Material View

3. **Table Columns**
   - Auction ID
   - Seller Name
   - Location
   - Category
   - Form
   - Finish
   - Choice
   - Total Weight (t)
   - Highest Bid (€/t)
   - Actions (View Details)

4. **Features**
   - Real-time bid updates
   - "Best Offer" indicator (when no bids yet)
   - Tags (New this week, Price reduction)
   - Download functionality

### Material Upload & Template Management

1. **Material Upload Flow**
   - **Option 1: Create from Template** (Recommended for frequent sellers)
     - Template selector dropdown/search at the top of the form
     - When template is selected, all fields auto-populate (except quantity)
     - Seller only needs to specify quantity
     - Clear visual indicator showing "Creating from template: [Template Name]"
     - Option to "Edit template values" if seller wants to override any field
     - "Save as new template" checkbox option when submitting
   - **Option 2: Create from Scratch**
     - Full form with all fields
     - "Save as template" button at the bottom (saves current form state as template)
   - **Option 3: Create from Existing Material**
     - "Use as template" button on approved materials in seller's material list
     - Opens material upload form with all fields pre-filled (except quantity)
     - Seller can edit any field before submitting

2. **Template Management UI**
   - **Template List View** (Seller Dashboard)
     - Table/card view of all seller's templates
     - Columns/fields:
       - Template Name (editable inline or via modal)
       - Categories (display as badges)
       - Form/Finish/Choice (display as badges)
       - Location
       - Usage Count (with "Last used: [date]" tooltip)
       - Actions: Use, Edit, Delete, Duplicate
     - Search/filter by template name, categories, location
     - Sort by: Name, Usage Count, Last Used, Created Date
     - Empty state: "No templates yet. Create your first template from a material upload."
   - **Template Creation/Edit Modal**
     - Same form fields as material upload (except quantity)
     - Template name field at the top (required)
     - All material attribute fields
     - "Save Template" button
     - Validation: Template name required, at least one category required
   - **Template Usage Indicator**
     - When viewing a material created from a template, show badge: "Created from template: [Template Name]"
     - Link to view/edit the template
   - **Quick Actions**
     - "Use Template" button on template cards/list items
     - Opens material upload form with template pre-filled
     - Keyboard shortcut support (e.g., "T" to open template selector)

3. **UX Considerations**
   - **Template Recommendations**
     - Show "Most Used Templates" section at top of template list
     - Suggest templates based on recently used categories
     - "Quick Create" buttons for top 3 most-used templates
   - **Template Validation**
     - Warn seller if template hasn't been used in X months ("Consider updating or archiving")
     - Show success message when template is used: "Material created from template '[Name]'"
   - **Bulk Operations** (Future Enhancement)
     - "Create multiple materials from template" option
     - Bulk quantity input (e.g., create 5 materials with different quantities)
   - **Template Sharing** (Future Enhancement)
     - Option to share templates with team members (if using WorkOS organizations)
     - Public template marketplace (optional, seller-controlled)

4. **Material Upload Form Enhancements**
   - Template selector component at the top:
     - Dropdown with search functionality
     - "Create new template" option in dropdown
     - Recent templates shown first
     - Visual preview of template attributes when hovering
   - Form state management:
     - When template selected, disable auto-populated fields with visual indicator
     - "Override template values" toggle to enable editing
     - Clear visual distinction between template values and custom values
   - Quantity field:
     - Prominent placement (since it's the only required field when using template)
     - Unit selector (ton, kg, m³, etc.) based on material type
     - Validation feedback

## Security Considerations

1. **Role-Based Access Control**
   - Admin-only mutations check role before execution
   - Seller-only material creation
   - Buyer-only bid placement

2. **Data Isolation**
   - Users can only see approved materials
   - Sellers see their own materials (pending/approved/rejected)
   - Admins see all materials

3. **Bid Validation**
   - Server validates bid amount > current highest
   - Server validates auction is live
   - Server validates rate limits

4. **Material Approval**
   - Only admins can approve/reject
   - Rejection reasons logged for audit

## Performance Considerations

1. **Indexes**
   - All foreign keys indexed
   - Status fields indexed for filtering
   - Date ranges indexed for time-based queries

2. **Aggregates (CQRS Read Models)**
   - All aggregate tables (`auctionAggregates`, `materialAggregates`, `auctionMaterialAggregates`, `bidAggregates`) provide fast queries for current state
   - Avoids scanning all events for current state
   - Can be rebuilt from event stream if corrupted or for migrations
   - Updated synchronously when events are created (ensures consistency)

3. **Real-time Subscriptions**
   - Use Convex real-time queries for live auction updates
   - Debounce filter changes to reduce query frequency

4. **Pagination**
   - Consider pagination for large auction lists
   - Virtual scrolling for material tables

## Future Enhancements

1. **Material Types** ✅ **Designed for Expansion**
   - Extend beyond steel to other materials by adding new category groups (e.g., "Concrete", "Wood", "Glass")
   - Material type is determined by category groups, so no schema changes needed
   - ✅ **Pluggable validators**: Implement `ConcreteValidator`, `WoodValidator`, etc.
   - ✅ **Pluggable pricing**: Implement `ConcretePricingStrategy`, `WoodPricingStrategy`, etc.
   - ✅ **Normalized quantity model**: Supports m³, pallets, bags, pieces (not just tonnes)
   - ✅ **Flexible attributes**: JSONB-style attributes support any material-specific fields
   - **Expansion effort**: Medium (2-3 weeks) since architecture is already in place

2. **Advanced Bidding**
   - Proxy bidding (auto-bid up to max)
   - Bid increments/rules
   - Reserve prices

3. **Notifications**
   - Email/SMS alerts for outbid
   - Auction start/end notifications
   - Material approval notifications

4. **Analytics**
   - Bid history charts
   - Material performance metrics
   - Seller/buyer statistics

5. **Enterprise Features**
   - WorkOS organization integration
   - Team-based permissions
   - Bulk material upload

## Resolved Decisions

1. **Auction ID Generation** ✅ **RESOLVED**
   - Uses Convex's built-in `_id` field (auto-generated UUID)
   - No custom ID generation needed - Convex guarantees uniqueness
   - `_id` is indexed by default for efficient lookups

2. **Currency Support** ✅ **RESOLVED**
   - Now supports extensible currency strings: MXN, USD, EUR
   - Validation via `SUPPORTED_CURRENCIES` constant
   - Exchange rate handling deferred to future enhancement

3. **Single Active Auction Constraint** ✅ **INTENTIONAL SIMPLIFICATION**
   - Only one auction can be "live" at a time
   - This simplifies the initial implementation for a new business
   - Can be refactored to support concurrent auctions in the future if needed

4. **Event Sourcing Considerations** ✅ **RESOLVED**
   - All events include `schemaVersion` field (start at 1, increment on changes)
   - Unified event store uses async processing via scheduled function (eventual consistency)
   - Aggregate rebuilds recommended: on-demand for migrations, scheduled for maintenance

## Deferred Features

1. **Anti-Sniping Logic**
   - Deferred to future iteration (considered overkill for initial launch)
   - Can add `antiSnipeWindowMs` and `originalEndDate` fields when needed

2. **Deposit/Escrow System**
   - Payments will be added in a future phase
   - First priority is to implement and test the event-driven auction mechanics

## Open Questions

1. **Material Tags**
   - How are tags assigned? (Admin, automatic, seller?)
   - Should tags be a separate table or array field?

2. **Bid Withdrawal**
   - Should we allow bid withdrawal (as soft delete event)?
   - What are the business rules?

3. **Auction Frequency**
   - How granular should custom frequency be?
   - Should admins set per-auction or global default?

4. **Template ID Generation**
   - Currently using custom string format
   - Consider migrating to Convex `_id` pattern for consistency with auctions

## References

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)
- [Effect Schema Documentation](https://effect.website/docs/schema)
- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
- TDR-0004: Client-Side Validation Can Be Bypassed
- ADR-001: Effect-TS Integration
- ADR-003: Convex Backend
