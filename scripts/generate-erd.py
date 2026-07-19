#!/usr/bin/env python3
"""Tavli ERD v3 — orthogonal routing, no bindings, light theme.

Fixes over v2 (user-reported):
1. Arrows detached from boxes  -> caused by start/endBinding: editors recompute
   bound endpoints on load and detach them. Fix: NO bindings; exact endpoint
   geometry computed on the box border.
2. Arrows crossing boxes       -> caused by straight center-to-center diagonals.
   Fix: PCB-style orthogonal routing. All vertical runs live in empty gutters
   between columns (one lane per arrow), long hauls ride a corridor strip above
   all content, and columns are reordered so most FKs are same/adjacent column.
3. Tenancy mesh clutter        -> restaurantId/organizationId scoping arrows are
   omitted entirely; every card lists them as >fields and the legend explains.

A built-in validator asserts zero arrow-segment/box intersections before writing.
"""
import json, random, sys
from pathlib import Path

rnd = random.Random(11)
def n(): return rnd.randint(1, 2_000_000_000)

# ---- palette (light theme; Excalidraw dark mode auto-inverts) ---------------
DOM = {
 "identity":"#2563eb","menu":"#16a34a","floor":"#d97706","ordering":"#dc2626",
 "reservations":"#7c3aed","scheduling":"#0891b2","attendance":"#65a30d",
 "tips":"#db2777","system":"#64748b"}
DOM_LABEL = {
 "identity":"Identity & Restaurant","menu":"Menu","floor":"Floor",
 "ordering":"Ordering & Payments","reservations":"Reservations",
 "scheduling":"Scheduling","attendance":"Attendance","tips":"Tips","system":"System"}
TXT_TITLE="#0f172a"; TXT_BODY="#334155"; TXT_MUTED="#64748b"

FIELDS = {
 "menus":[">restaurantId","name","displayOrder"],
 "menuCategories":[">menuId","name","displayOrder"],
 "menuItems":[">categoryId","basePrice","prepStation"],
 "optionGroups":[">restaurantId","selectionType","min/max"],
 "options":[">optionGroupId","priceModifier"],
 "menuItemOptionGroups":[">menuItemId",">optionGroupId"],
 "sections":[">restaurantId","displayOrder"],
 "tables":[">restaurantId","*sectionId","tableNumber","capacity"],
 "tableLocks":[">tableId","startsAt","endsAt"],
 "sessions":[">restaurantId","*tableId","userId","joinCode","*serverMemberId","paymentState"],
 "orders":[">sessionId",">tableId","status","totalAmount","*attributedMemberId"],
 "orderItems":[">orderId",">menuItemId","qty","unitPrice"],
 "orderDayCounters":[">restaurantId","serviceDateKey"],
 "payments":[">restaurantId","*orderId","*sessionId","amount","status"],
 "stripeWebhookEvents":["#eventId","*paymentId"],
 "organizations":["#name","#slug","isActive"],
 "restaurants":["ownerId",">organizationId","#slug","currency","stripeAccountId"],
 "restaurantMembers":["*userId","*employeeAccountId",">restaurantId","role","isActive"],
 "employeeAccounts":[">restaurantId","name","pinHash"],
 "invitations":["#token","email",">organizationId","role","status"],
 "userRoles":["#userId","email","roles[]"],
 "userSettings":["#userId","theme","language"],
 "reservations":[">restaurantId",">tableIds[]","*sessionId","partySize","status"],
 "reservationSettings":[">restaurantId","turnMinutes","blackouts"],
 "shifts":[">memberId",">restaurantId","*templateId","startsAt","status"],
 "shiftTemplates":[">memberId",">restaurantId","dayOfWeek","duration"],
 "shiftTableAssignments":[">shiftId",">tableId","window"],
 "shiftSectionAssignments":[">shiftId",">sectionId","window"],
 "clockEvents":[">memberId","*shiftId","type","source"],
 "absences":[">memberId","date","type","status"],
 "shiftAttendance":[">shiftId",">memberId","status","lateMinutes"],
 "tipPools":[">restaurantId","businessDate","rule"],
 "tipPoolShares":[">poolId",">memberId","amountCents"],
 "tipEntries":[">restaurantId","*memberId","*shiftId","amountCents"],
 "featureFlags":["#key","enabled"],
 "dashboardLayouts":["userId","*restaurantId","name"],
 "dashboardTemplates":[">restaurantId","publishedBy"],
 "allEvents":["eventType","aggregateType","aggregateId"],
}

# columns ordered so related tables are same-column or adjacent-column --------
COLS = [
 [("menu",k) for k in ["menus","menuCategories","menuItems","menuItemOptionGroups","optionGroups","options"]],
 [("ordering",k) for k in ["orderItems","orders","sessions","payments","stripeWebhookEvents","orderDayCounters"]],
 [("floor",k) for k in ["sections","tables","tableLocks"]] +
   [("reservations",k) for k in ["reservations","reservationSettings"]],
 [("scheduling",k) for k in ["shiftTableAssignments","shifts","shiftTemplates","shiftSectionAssignments"]],
 [("attendance",k) for k in ["clockEvents","shiftAttendance","absences"]] +
   [("tips",k) for k in ["tipPools","tipPoolShares","tipEntries"]],
 [("identity",k) for k in ["organizations","restaurants","restaurantMembers","employeeAccounts","invitations","userRoles","userSettings"]],
 [("system",k) for k in ["featureFlags","dashboardLayouts","dashboardTemplates","allEvents"]],
]

W=260; STEP=380; NCOL=len(COLS)
COL_X=[60+i*STEP for i in range(NCOL)]
TITLE_H=30; ROW_H=20; PAD=16
START_Y=210; GAP=26; DOM_GAP=64
CORRIDOR_Y=[118,132,146]                 # empty strip above zones (zones start at 164)
SLOTS_Y=[0,18,-18,36,-36,54,-54]         # left/right edge anchor spread
SLOTS_X=[0,24,-24,48,-48]                # top/bottom edge anchor spread

geom, dom_of, col_of, idx_of = {}, {}, {}, {}
zone_members = {}
elements=[]

def E(el):
    el.setdefault("angle",0); el.setdefault("strokeWidth",1)
    el.setdefault("strokeStyle","solid"); el.setdefault("roughness",0)
    el.setdefault("opacity",100); el.setdefault("groupIds",[])
    el.setdefault("frameId",None); el.setdefault("roundness",None)
    el.setdefault("seed",n()); el.setdefault("version",1)
    el.setdefault("versionNonce",n()); el.setdefault("isDeleted",False)
    el.setdefault("boundElements",[]); el.setdefault("updated",1700000000000)
    el.setdefault("link",None); el.setdefault("locked",False)
    elements.append(el); return el

# ---- place cards ------------------------------------------------------------
for ci,col in enumerate(COLS):
    y=START_Y; prev=None
    for pos,(dom,key) in enumerate(col):
        if prev is not None and dom!=prev: y+=DOM_GAP
        h=TITLE_H+ROW_H*len(FIELDS[key])+PAD
        geom[key]=(COL_X[ci],y,W,h); dom_of[key]=dom; col_of[key]=ci; idx_of[key]=pos
        zone_members.setdefault((ci,dom),[]).append(key)
        prev=dom; y+=h+GAP

# ---- zones ------------------------------------------------------------------
for (ci,dom),keys in zone_members.items():
    ys=[geom[k][1] for k in keys]; ye=[geom[k][1]+geom[k][3] for k in keys]
    zx,zy=COL_X[ci]-18,min(ys)-46
    zw,zh=W+36,(max(ye)-min(ys))+64
    c=DOM[dom]
    E({"id":f"zone_{ci}_{dom}","type":"rectangle","x":zx,"y":zy,"width":zw,"height":zh,
       "strokeColor":c,"backgroundColor":c,"fillStyle":"solid","opacity":7,
       "strokeStyle":"dashed","strokeWidth":1,"roundness":{"type":3}})
    E({"id":f"zonelabel_{ci}_{dom}","type":"text","x":zx+16,"y":zy+12,"width":zw-32,"height":22,
       "strokeColor":c,"backgroundColor":"transparent","fontSize":17,"fontFamily":2,
       "text":DOM_LABEL[dom],"textAlign":"left","verticalAlign":"top","containerId":None,
       "originalText":DOM_LABEL[dom],"lineHeight":1.15,"baseline":13})

# ---- cards (single top-anchored text block; see v2 lesson) ------------------
for key,(x,y,w,h) in geom.items():
    c=DOM[dom_of[key]]
    E({"id":f"rect_{key}","type":"rectangle","x":x,"y":y,"width":w,"height":h,
       "strokeColor":c,"backgroundColor":"#ffffff","fillStyle":"solid",
       "strokeWidth":1.5,"roundness":{"type":3}})
    E({"id":f"hdr_{key}","type":"line","x":x,"y":y+TITLE_H,"width":w,"height":0,
       "strokeColor":c,"backgroundColor":"transparent","opacity":55,
       "points":[[0,0],[w,0]]})
    lines=[key,""]+FIELDS[key]; txt="\n".join(lines)
    E({"id":f"body_{key}","type":"text","x":x+12,"y":y+9,"width":w-24,
       "height":round(13*1.45*len(lines)),
       "strokeColor":TXT_BODY,"backgroundColor":"transparent","fontSize":13,"fontFamily":3,
       "text":txt,"textAlign":"left","verticalAlign":"top","containerId":None,
       "originalText":txt,"lineHeight":1.45,"baseline":10})

# ---- routing engine ---------------------------------------------------------
anchors={}   # (key, side) -> used slots
lanes={}     # gutter index -> count

def anchor_pt(key, side):
    reg=anchors.setdefault((key,side),[])
    s=(SLOTS_Y if side in("left","right") else SLOTS_X)[len(reg)]
    reg.append(s)
    x,y,w,h=geom[key]
    return {"left":(x,y+h/2+s),"right":(x+w,y+h/2+s),
            "top":(x+w/2+s,y),"bottom":(x+w/2+s,y+h)}[side]

def slot_pair(a,sa,b,sb):
    ra=anchors.setdefault((a,sa),[]); rb=anchors.setdefault((b,sb),[])
    s=SLOTS_X[max(len(ra),len(rb))]
    ra.append(s); rb.append(s); return s

def lane_x(g):
    i=lanes.get(g,0); lanes[g]=i+1
    assert i<6, f"gutter {g} overloaded"
    return COL_X[g]+W+26+i*12

# child -> parent (arrow points at referenced table)
# kind: v = same-column vertically adjacent; u = same-column U-turn via side;
#       x = adjacent-column crossing; c = long-haul corridor
ARROWS=[
 ("menuCategories","menus","v",None),("menuItems","menuCategories","v",None),
 ("menuItemOptionGroups","menuItems","v",None),("menuItemOptionGroups","optionGroups","v",None),
 ("options","optionGroups","v",None),
 ("orderItems","orders","v",None),("orders","sessions","v",None),
 ("payments","sessions","v",None),("stripeWebhookEvents","payments","v",None),
 ("tables","sections","v",None),("tableLocks","tables","v",None),
 ("shiftTableAssignments","shifts","v",None),("shifts","shiftTemplates","v",None),
 ("tipPoolShares","tipPools","v",None),
 ("restaurants","organizations","v",None),("restaurantMembers","employeeAccounts","v",None),
 ("payments","orders","u","left"),("reservations","tables","u","right"),
 ("shiftSectionAssignments","shifts","u","right"),("invitations","organizations","u","right"),
 ("orderItems","menuItems","x",None),("sessions","tables","x",None),
 ("orders","tables","x",None),
 ("reservations","sessions","x",None),("shiftTableAssignments","tables","x",None),
 ("shiftSectionAssignments","sections","x",None),("clockEvents","shifts","x",None),
 ("shiftAttendance","shifts","x",None),("tipEntries","shifts","x",None),
 ("absences","restaurantMembers","x",None),("tipPoolShares","restaurantMembers","x",None),
 ("tipEntries","restaurantMembers","x",None),
 ("shifts","restaurantMembers","c",0),
 ("sessions","restaurantMembers","c",1),("orders","restaurantMembers","c",2),
]
# dashed where the FK is optional / XOR in schema.ts
OPTIONAL={("sessions","tables"),("payments","orders"),("payments","sessions"),
 ("stripeWebhookEvents","payments"),("reservations","sessions"),("reservations","tables"),
 ("shifts","shiftTemplates"),("clockEvents","shifts"),("tipEntries","shifts"),
 ("restaurantMembers","employeeAccounts"),("sessions","restaurantMembers"),
 ("orders","restaurantMembers"),("tables","sections"),
 ("tipEntries","restaurantMembers")}
CORRIDOR_DROP_GUTTER=4   # descend between Attendance/Tips and Identity

routes=[]  # (src,dst,[abs points])
for src,dst,kind,extra in ARROWS:
    if kind=="v":
        sx,sy,sw,sh=geom[src]; dx,dy,dw,dh=geom[dst]
        cx=sx+sw/2
        if dy> sy:  # parent below child
            s=slot_pair(src,"bottom",dst,"top"); pts=[(cx+s,sy+sh),(cx+s,dy)]
        else:       # parent above child
            s=slot_pair(src,"top",dst,"bottom"); pts=[(cx+s,sy),(cx+s,dy+dh)]
    elif kind=="u":
        side=extra; g=col_of[src] if side=="right" else col_of[src]-1
        p1=anchor_pt(src,side); p2=anchor_pt(dst,side); lx=lane_x(g)
        pts=[p1,(lx,p1[1]),(lx,p2[1]),p2]
    elif kind=="x":
        cs,cd=col_of[src],col_of[dst]
        if cs<cd: p1=anchor_pt(src,"right"); p2=anchor_pt(dst,"left"); g=cs
        else:     p1=anchor_pt(src,"left");  p2=anchor_pt(dst,"right"); g=cd
        if abs(p1[1]-p2[1])<6: pts=[p1,p2]
        else:
            lx=lane_x(g); pts=[p1,(lx,p1[1]),(lx,p2[1]),p2]
    elif kind=="c":
        p1=anchor_pt(src,"right"); lx1=lane_x(col_of[src])
        cy=CORRIDOR_Y[extra]; lx2=lane_x(CORRIDOR_DROP_GUTTER)
        p2=anchor_pt(dst,"left")
        pts=[p1,(lx1,p1[1]),(lx1,cy),(lx2,cy),(lx2,p2[1]),p2]
    routes.append((src,dst,pts))

# ---- validator: no arrow segment may cross any card ------------------------
def seg_hits_rect(p1,p2,rect,eps=1.0):
    (x,y,w,h)=rect
    x0,x1=x+eps,x+w-eps; y0,y1=y+eps,y+h-eps
    (ax,ay),(bx,by)=p1,p2
    if ay==by:  # horizontal
        return y0<ay<y1 and max(ax,bx)>x0 and min(ax,bx)<x1
    if ax==bx:  # vertical
        return x0<ax<x1 and max(ay,by)>y0 and min(ay,by)<y1
    # diagonal (shouldn't exist) — conservative bbox check
    return not(max(ax,bx)<x0 or min(ax,bx)>x1 or max(ay,by)<y0 or min(ay,by)>y1)

violations=[]
for src,dst,pts in routes:
    for i in range(len(pts)-1):
        for key,rect in geom.items():
            if key in (src,dst): continue
            if seg_hits_rect(pts[i],pts[i+1],rect):
                violations.append((src,dst,i,key))
if violations:
    print("ROUTING VIOLATIONS:",violations); sys.exit(1)

# ---- emit arrows (NO bindings — deterministic across editors) ---------------
for src,dst,pts in routes:
    x0,y0=pts[0]
    rel=[[px-x0,py-y0] for px,py in pts]
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    E({"id":f"arr_{src}__{dst}","type":"arrow","x":x0,"y":y0,
       "width":max(xs)-min(xs),"height":max(ys)-min(ys),
       "strokeColor":DOM[dom_of[src]],"backgroundColor":"transparent","fillStyle":"solid",
       "strokeWidth":1.5,
       "strokeStyle":"dashed" if (src,dst) in OPTIONAL else "solid",
       "points":rel,
       "startBinding":None,"endBinding":None,
       "startArrowhead":None,"endArrowhead":"triangle",
       "roundness":None,"lastCommittedPoint":None,"elbowed":False})

# ---- title / subtitle / legend ---------------------------------------------
E({"id":"doc_title","type":"text","x":60,"y":40,"width":900,"height":38,
   "strokeColor":TXT_TITLE,"backgroundColor":"transparent","fontSize":30,"fontFamily":2,
   "text":"Tavli — Entity Relationship Diagram","textAlign":"left","verticalAlign":"top",
   "containerId":None,"originalText":"Tavli — Entity Relationship Diagram","lineHeight":1.2,"baseline":24})
sub="38 Convex tables · arrows point at the referenced table · restaurant/org scoping arrows omitted (see legend)"
E({"id":"doc_sub","type":"text","x":60,"y":84,"width":1100,"height":20,
   "strokeColor":TXT_MUTED,"backgroundColor":"transparent","fontSize":14,"fontFamily":3,
   "text":sub,"textAlign":"left","verticalAlign":"top","containerId":None,
   "originalText":sub,"lineHeight":1.3,"baseline":11})

lx=COL_X[-1]+W+70; ly=210
E({"id":"leg_title","type":"text","x":lx,"y":ly-40,"width":220,"height":24,
   "strokeColor":TXT_TITLE,"backgroundColor":"transparent","fontSize":18,"fontFamily":2,
   "text":"Legend","textAlign":"left","verticalAlign":"top","containerId":None,
   "originalText":"Legend","lineHeight":1.2,"baseline":14})
E({"id":"leg_a1","type":"arrow","x":lx,"y":ly+8,"width":44,"height":0,
   "strokeColor":DOM["identity"],"backgroundColor":"transparent","strokeWidth":1.5,
   "points":[[0,0],[44,0]],"endArrowhead":"triangle","startArrowhead":None,
   "startBinding":None,"endBinding":None,"roundness":{"type":2}})
E({"id":"leg_a1t","type":"text","x":lx+56,"y":ly,"width":240,"height":18,
   "strokeColor":TXT_BODY,"backgroundColor":"transparent","fontSize":13,"fontFamily":3,
   "text":"required FK → referenced table","textAlign":"left","verticalAlign":"top",
   "containerId":None,"originalText":"required FK → referenced table","lineHeight":1.3,"baseline":10})
E({"id":"leg_a2","type":"arrow","x":lx,"y":ly+34,"width":44,"height":0,
   "strokeColor":DOM["identity"],"backgroundColor":"transparent","strokeWidth":1.5,"strokeStyle":"dashed",
   "points":[[0,0],[44,0]],"endArrowhead":"triangle","startArrowhead":None,
   "startBinding":None,"endBinding":None,"roundness":{"type":2}})
E({"id":"leg_a2t","type":"text","x":lx+56,"y":ly+26,"width":240,"height":18,
   "strokeColor":TXT_BODY,"backgroundColor":"transparent","fontSize":13,"fontFamily":3,
   "text":"optional / XOR FK","textAlign":"left","verticalAlign":"top",
   "containerId":None,"originalText":"optional / XOR FK","lineHeight":1.3,"baseline":10})
for i,(sym,desc) in enumerate([(">","foreign key"),("*","optional / XOR FK field"),("#","natural / lookup key")]):
    yy=ly+62+i*24
    E({"id":f"leg_s{i}","type":"text","x":lx,"y":yy,"width":250,"height":18,
       "strokeColor":TXT_BODY,"backgroundColor":"transparent","fontSize":13,"fontFamily":3,
       "text":f"{sym}  {desc}","textAlign":"left","verticalAlign":"top","containerId":None,
       "originalText":f"{sym}  {desc}","lineHeight":1.3,"baseline":10})
note=("Every table also carries >restaurantId /\n>organizationId scoping fields; those\narrows are omitted to keep the diagram\nreadable. Also omitted: denormalized\nback-pointers (activePaymentId), price-\nsnapshot refs in orderItems.selected-\nOptions, invitations.restaurantIds[]\ngrant lists, and soft-delete parent refs.\nTables without arrows are scoped\nreference/config data. allEvents is a\npolymorphic event store over all\naggregates.")
E({"id":"leg_note","type":"text","x":lx,"y":ly+142,"width":260,"height":130,
   "strokeColor":TXT_MUTED,"backgroundColor":"transparent","fontSize":12,"fontFamily":3,
   "text":note,"textAlign":"left","verticalAlign":"top","containerId":None,
   "originalText":note,"lineHeight":1.4,"baseline":9})

doc={"type":"excalidraw","version":2,
 "source":"https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor",
 "elements":elements,
 "appState":{"gridSize":20,"gridStep":5,"gridModeEnabled":False,
             "viewBackgroundColor":"#ffffff"},
 "files":{}}
out=str(Path(__file__).resolve().parent.parent / "documentation" / "erd.excalidraw")
with open(out,"w") as f: json.dump(doc,f,indent=2)
print(f"entities={len(geom)} arrows={len(routes)} elements={len(elements)} violations=0")
