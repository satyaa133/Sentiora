import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteAccount = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ deleteAccount, user: { email: "ada@gmail.com", profile: null } }),
}));

import AccountSettingsView from "../components/views/AccountSettingsView";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderSettings() {
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<AccountSettingsView />} />
        <Route path="/" element={<p>Landing page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("delete account (D15)", () => {
  it("needs the password, keeps the account on a wrong one, and signs out when done", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const form = screen.getByRole("form", { name: "Confirm account deletion" });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByText("Enter your password to confirm.")).toBeInTheDocument();
    expect(deleteAccount).not.toHaveBeenCalled();

    const wrong = new AxiosError("wrong");
    wrong.response = { status: 401, data: { error: { code: "AUTH_INVALID_CREDENTIALS" } } } as never;
    deleteAccount.mockRejectedValueOnce(wrong);
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByText("That password is not right, so nothing was deleted.")).toBeInTheDocument();
    expect(form).toBeInTheDocument();

    deleteAccount.mockResolvedValueOnce(undefined);
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "Analytical1Engine" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(deleteAccount).toHaveBeenLastCalledWith("Analytical1Engine"));
    expect(await screen.findByText("Landing page")).toBeInTheDocument();
  });

  it("Cancel leaves everything as it was", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Confirm account deletion" })).not.toBeInTheDocument();
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
