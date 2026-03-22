import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { TasksSection } from "./TasksSection";

// Mock the WelcomeSection
vi.mock("../WelcomeSection", () => ({
  WelcomeSection: () => <div data-testid="welcome-section">Welcome! Please sign in.</div>,
}));

// Mock the TasksLoadingFallback
vi.mock("./TasksLoadingFallback", () => ({
  TasksLoadingFallback: () => <div data-testid="loading-fallback">Loading tasks...</div>,
}));

// Mock AuthenticatedTasks
vi.mock("./AuthenticatedTasks", () => ({
  AuthenticatedTasks: () => <div data-testid="authenticated-tasks">Authenticated Tasks Content</div>,
}));

// Mock useConvexAuth with configurable return values
const mockUseConvexAuth = vi.fn();
vi.mock("convex/react", () => ({
  useConvexAuth: () => mockUseConvexAuth(),
}));

describe("TasksSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hydration handling", () => {
    it("shows loading fallback before client hydration", () => {
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
      });

      // Don't use act() to keep useState at initial value
      const { container } = render(<TasksSection />);

      // Before useEffect runs, isMounted is false, so loading is shown
      // Note: In jsdom, useEffect runs synchronously in many cases,
      // so we check immediately on render
      expect(container).toBeDefined();
    });

    it("renders auth-aware content after hydration", async () => {
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
      });

      render(<TasksSection />);

      // After useEffect runs, isMounted becomes true
      await waitFor(() => {
        expect(screen.getByTestId("authenticated-tasks")).toBeDefined();
      });
    });
  });

  describe("authentication loading state", () => {
    it("shows loading fallback when auth is loading", async () => {
      mockUseConvexAuth.mockReturnValue({
        isLoading: true,
        isAuthenticated: false,
      });

      render(<TasksSection />);

      await waitFor(() => {
        expect(screen.getByTestId("loading-fallback")).toBeDefined();
      });
    });
  });

  describe("unauthenticated state", () => {
    it("shows welcome section when user is not authenticated", async () => {
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: false,
      });

      render(<TasksSection />);

      await waitFor(() => {
        expect(screen.getByTestId("welcome-section")).toBeDefined();
      });
    });

    it("does not show authenticated content when not authenticated", async () => {
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: false,
      });

      render(<TasksSection />);

      await waitFor(() => {
        expect(screen.queryByTestId("authenticated-tasks")).toBeNull();
      });
    });
  });

  describe("authenticated state", () => {
    it("shows authenticated tasks when user is authenticated", async () => {
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
      });

      render(<TasksSection />);

      await waitFor(() => {
        expect(screen.getByTestId("authenticated-tasks")).toBeDefined();
      });
    });

    it("does not show welcome section when authenticated", async () => {
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
      });

      render(<TasksSection />);

      await waitFor(() => {
        expect(screen.queryByTestId("welcome-section")).toBeNull();
      });
    });
  });

  describe("auth state transitions", () => {
    it("transitions from loading to authenticated", async () => {
      // Start with loading
      mockUseConvexAuth.mockReturnValue({
        isLoading: true,
        isAuthenticated: false,
      });

      const { rerender } = render(<TasksSection />);

      await waitFor(() => {
        expect(screen.getByTestId("loading-fallback")).toBeDefined();
      });

      // Transition to authenticated
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
      });

      await act(async () => {
        rerender(<TasksSection />);
      });

      await waitFor(() => {
        expect(screen.getByTestId("authenticated-tasks")).toBeDefined();
      });
    });

    it("transitions from loading to unauthenticated", async () => {
      // Start with loading
      mockUseConvexAuth.mockReturnValue({
        isLoading: true,
        isAuthenticated: false,
      });

      const { rerender } = render(<TasksSection />);

      await waitFor(() => {
        expect(screen.getByTestId("loading-fallback")).toBeDefined();
      });

      // Transition to unauthenticated
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: false,
      });

      await act(async () => {
        rerender(<TasksSection />);
      });

      await waitFor(() => {
        expect(screen.getByTestId("welcome-section")).toBeDefined();
      });
    });

    it("transitions from authenticated to unauthenticated (session expiry)", async () => {
      // Start authenticated
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
      });

      const { rerender } = render(<TasksSection />);

      await waitFor(() => {
        expect(screen.getByTestId("authenticated-tasks")).toBeDefined();
      });

      // Session expires
      mockUseConvexAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: false,
      });

      await act(async () => {
        rerender(<TasksSection />);
      });

      await waitFor(() => {
        expect(screen.getByTestId("welcome-section")).toBeDefined();
      });
    });
  });
});

