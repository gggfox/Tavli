/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

describe("tasks", () => {
  describe("user isolation", () => {
    it("each user only sees their own tasks", async () => {
      const t = convexTest(schema, modules);

      // Create identity for User A (Sarah)
      const asSarah = t.withIdentity({
        name: "Sarah",
        subject: "user_sarah_123",
      });

      // Sarah creates her tasks
      await asSarah.mutation(api.tasks.create, { text: "Sarah's task 1" });
      await asSarah.mutation(api.tasks.create, { text: "Sarah's task 2" });

      // Sarah should see only her 2 tasks
      const sarahsTasks = await asSarah.query(api.tasks.get);
      expect(sarahsTasks).toHaveLength(2);
      expect(sarahsTasks).toMatchObject([
        { text: "Sarah's task 1", userId: "user_sarah_123" },
        { text: "Sarah's task 2", userId: "user_sarah_123" },
      ]);

      // Create identity for User B (Lee)
      const asLee = t.withIdentity({ name: "Lee", subject: "user_lee_456" });

      // Lee should see NO tasks (Sarah's tasks are not visible to Lee)
      const leesTasksInitially = await asLee.query(api.tasks.get);
      expect(leesTasksInitially).toHaveLength(0);
      expect(leesTasksInitially).toEqual([]);

      // Lee creates his own task
      await asLee.mutation(api.tasks.create, { text: "Lee's task 1" });

      // Lee should see only his 1 task
      const leesTasks = await asLee.query(api.tasks.get);
      expect(leesTasks).toHaveLength(1);
      expect(leesTasks).toMatchObject([
        { text: "Lee's task 1", userId: "user_lee_456" },
      ]);

      // Sarah should still see only her 2 tasks (not Lee's)
      const sarahsTasksAfter = await asSarah.query(api.tasks.get);
      expect(sarahsTasksAfter).toHaveLength(2);
      expect(
        sarahsTasksAfter.every((task) => task.userId === "user_sarah_123")
      ).toBe(true);
    });

    it("user cannot delete another user's task", async () => {
      const t = convexTest(schema, modules);

      // Sarah creates a task
      const asSarah = t.withIdentity({
        name: "Sarah",
        subject: "user_sarah_123",
      });
      await asSarah.mutation(api.tasks.create, {
        text: "Sarah's private task",
      });

      // Get Sarah's task ID
      const sarahsTasks = await asSarah.query(api.tasks.get);
      const sarahsTaskId = sarahsTasks[0]._id;

      // Lee tries to delete Sarah's task
      const asLee = t.withIdentity({ name: "Lee", subject: "user_lee_456" });

      await expect(
        asLee.mutation(api.tasks.remove, { id: sarahsTaskId })
      ).rejects.toThrow("Not authorized to delete this task");

      // Sarah's task should still exist
      const sarahsTasksAfter = await asSarah.query(api.tasks.get);
      expect(sarahsTasksAfter).toHaveLength(1);
    });

    it("user cannot toggle another user's task", async () => {
      const t = convexTest(schema, modules);

      // Sarah creates a task
      const asSarah = t.withIdentity({
        name: "Sarah",
        subject: "user_sarah_123",
      });
      await asSarah.mutation(api.tasks.create, { text: "Sarah's task" });

      // Get Sarah's task
      const sarahsTasks = await asSarah.query(api.tasks.get);
      const sarahsTaskId = sarahsTasks[0]._id;
      expect(sarahsTasks[0].isCompleted).toBe(false);

      // Lee tries to toggle Sarah's task
      const asLee = t.withIdentity({ name: "Lee", subject: "user_lee_456" });

      await expect(
        asLee.mutation(api.tasks.toggle, { id: sarahsTaskId })
      ).rejects.toThrow("Not authorized to modify this task");

      // Sarah's task should remain unchanged
      const sarahsTasksAfter = await asSarah.query(api.tasks.get);
      expect(sarahsTasksAfter[0].isCompleted).toBe(false);
    });
  });

  describe("authentication required", () => {
    it("unauthenticated user cannot query tasks", async () => {
      const t = convexTest(schema, modules);

      // Try to query without authentication
      await expect(t.query(api.tasks.get)).rejects.toThrow("Not authenticated");
    });

    it("unauthenticated user cannot create tasks", async () => {
      const t = convexTest(schema, modules);

      await expect(
        t.mutation(api.tasks.create, { text: "Should fail" })
      ).rejects.toThrow("Not authenticated");
    });
  });
});
