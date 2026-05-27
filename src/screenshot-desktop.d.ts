declare module "screenshot-desktop" {
  function screenshot(opts?: { format?: string; filename?: string }): Promise<Buffer>;
  export = screenshot;
}
