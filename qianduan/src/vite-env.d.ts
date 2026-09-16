/// <reference types="vite/client" />
declare module 'virtual:astra-catalog' {
  const activities: import('./portal/contracts').Activity[];
  export default activities;
}

declare module 'virtual:astra-spaces' {
  const manifest: { spaces: import('./domain/learning-spaces').LearningSpace[]; levels: { key: string; title: string }[] };
  export default manifest;
}

declare module 'virtual:astra-templates' {
  const templates: { key: string; space: string; subject: string; kind: 'template'; title: string; renderer: string; definition: Record<string, unknown>; capabilities: Record<string, unknown>; provenance: Record<string, unknown> }[];
  export default templates;
}
