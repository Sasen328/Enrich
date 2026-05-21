// The global SubTabBar (mounted in Layout.tsx) now renders Lead Factory
// sub-tabs from tab-registry.ts. This component is a no-op shim kept only
// because Signal Intel + Relationship Intel pages still import it. Safe
// to delete once those callers are updated.
export function LeadFactoryTabs() {
  return null;
}
