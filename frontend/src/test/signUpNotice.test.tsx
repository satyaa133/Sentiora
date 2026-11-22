import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const register = vi.fn();
const login = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ register, login }) }));

import SignUp from "../pages/SignUp";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function fill() {
  fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: "ada@gmail.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: "Analytical1Engine" } });
}

describe("sign-up privacy notice (D10)", () => {
  it("shows the notice and needs the box ticked before creating the account", async () => {
    render(
      <MemoryRouter>
        <SignUp />
      </MemoryRouter>,
    );
    expect(screen.getByRole("region", { name: "Privacy notice" })).toHaveTextContent(
      "do not use it to train their models",
    );
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Please agree to the privacy notice to create an account.")).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();

    register.mockResolvedValue(undefined);
    login.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("checkbox", { name: /agree to the privacy notice above/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(register).toHaveBeenCalledWith("ada@gmail.com", "Analytical1Engine", "Ada Lovelace"));
  });
});
