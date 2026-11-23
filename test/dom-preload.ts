import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Radix picks its layout effect once, at first import, from globalThis.document. Loading it here
// with a DOM present gives every test file the real effect regardless of file order.
GlobalRegistrator.register();
await import("@radix-ui/react-use-layout-effect");
await GlobalRegistrator.unregister();
