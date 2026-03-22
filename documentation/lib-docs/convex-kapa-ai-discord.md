4. **Event-Driven Programming:**
   - Use event-driven patterns where appropriate, such as event sourcing (recording state changes as events) and the Observer pattern for loose coupling. Convex’s real-time reactivity and workflow management make it well-suited for these patterns [Event Driven Programming: A Definitive Guide](https://stack.convex.dev/event-driven-programming#addressing-common-challenges-in-event-driven-programming).

5. **Repository Pattern:**
   - For client applications, use repository classes to abstract data access, with ConvexClient as the data source. This keeps your data logic organized and testable [Structuring your application](https://docs.convex.dev/client/android#structuring-your-application).

6. **Use of Indexes and Efficient Queries:**
   - Always prefer indexed queries over filtering in code for performance. Use `.withIndex` or `.withSearchIndex` for large or unbounded datasets, and only use `.filter` in code for small result sets [Best Practices](https://docs.convex.dev/understanding/best-practices/).

7. **Component-Based Backend (Convex Components):**
   - Leverage Convex Components to encapsulate reusable backend logic (e.g., counters, workflows, permission systems) in a modular, isolated, and composable way [Convex: The Software-Defined Database](https://stack.convex.dev/the-software-defined-database#introducing-convex-components).

8. **Keep Sync Engine Functions Light & Fast:**

- Queries and mutations should be fast and operate on a small number of records to maintain responsiveness. Use actions sparingly for batch jobs or external integrations [The Zen of Convex](https://docs.convex.dev/understanding/zen).
