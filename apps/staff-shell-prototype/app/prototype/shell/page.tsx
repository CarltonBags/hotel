// PROTOTYPE, throwaway. Three variants of the staff app shell, switchable via ?variant=, on /prototype/shell.
import { Suspense } from "react";
import { ShellPrototype } from "@/components/prototype/shell/ShellPrototype";

export default function Page() {
  return (
    <Suspense>
      <ShellPrototype />
    </Suspense>
  );
}
