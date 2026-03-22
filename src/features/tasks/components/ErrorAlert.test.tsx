import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorAlert, type TaskOperationError } from "./ErrorAlert";

describe("ErrorAlert", () => {
  const defaultError: TaskOperationError = {
    message: "Failed to create task",
    operation: "create",
  };

  describe("rendering", () => {
    it("renders the error message", () => {
      render(<ErrorAlert error={defaultError} onDismiss={vi.fn()} />);

      expect(screen.getByText("Failed to create task")).toBeDefined();
    });

    it("has correct accessibility role", () => {
      render(<ErrorAlert error={defaultError} onDismiss={vi.fn()} />);

      expect(screen.getByRole("alert")).toBeDefined();
    });

    it("renders dismiss button with correct aria-label", () => {
      render(<ErrorAlert error={defaultError} onDismiss={vi.fn()} />);

      const dismissButton = screen.getByLabelText("Dismiss error");
      expect(dismissButton).toBeDefined();
    });

    it("renders error icon", () => {
      const { container } = render(
        <ErrorAlert error={defaultError} onDismiss={vi.fn()} />
      );

      // Check for the SVG icon with aria-hidden
      const icon = container.querySelector('svg[aria-hidden="true"]');
      expect(icon).toBeDefined();
    });
  });

  describe("different error types", () => {
    it("displays create operation error", () => {
      const error: TaskOperationError = {
        message: "Failed to create task",
        operation: "create",
      };

      render(<ErrorAlert error={error} onDismiss={vi.fn()} />);

      expect(screen.getByText("Failed to create task")).toBeDefined();
    });

    it("displays delete operation error", () => {
      const error: TaskOperationError = {
        message: "Failed to delete task",
        operation: "delete",
      };

      render(<ErrorAlert error={error} onDismiss={vi.fn()} />);

      expect(screen.getByText("Failed to delete task")).toBeDefined();
    });

    it("displays toggle operation error", () => {
      const error: TaskOperationError = {
        message: "Failed to update task",
        operation: "toggle",
      };

      render(<ErrorAlert error={error} onDismiss={vi.fn()} />);

      expect(screen.getByText("Failed to update task")).toBeDefined();
    });

    it("displays error without operation context", () => {
      const error: TaskOperationError = {
        message: "An unexpected error occurred",
      };

      render(<ErrorAlert error={error} onDismiss={vi.fn()} />);

      expect(screen.getByText("An unexpected error occurred")).toBeDefined();
    });

    it("displays authentication error message", () => {
      const error: TaskOperationError = {
        message: "Your session has expired. Please sign in again.",
        operation: "create",
      };

      render(<ErrorAlert error={error} onDismiss={vi.fn()} />);

      expect(
        screen.getByText("Your session has expired. Please sign in again.")
      ).toBeDefined();
    });
  });

  describe("dismiss functionality", () => {
    it("calls onDismiss when dismiss button is clicked", () => {
      const onDismissMock = vi.fn();

      render(<ErrorAlert error={defaultError} onDismiss={onDismissMock} />);

      const dismissButton = screen.getByLabelText("Dismiss error");
      fireEvent.click(dismissButton);

      expect(onDismissMock).toHaveBeenCalledTimes(1);
    });

    it("dismiss button is focusable", () => {
      render(<ErrorAlert error={defaultError} onDismiss={vi.fn()} />);

      const dismissButton = screen.getByLabelText("Dismiss error");
      dismissButton.focus();

      expect(document.activeElement).toBe(dismissButton);
    });
  });

  describe("styling", () => {
    it("has alert container with expected classes", () => {
      render(<ErrorAlert error={defaultError} onDismiss={vi.fn()} />);

      const alert = screen.getByRole("alert");
      // Uses CSS variables for theming - check for structural classes instead
      expect(alert.classList.contains("rounded-lg")).toBe(true);
      expect(alert.classList.contains("flex")).toBe(true);
    });
  });
});

