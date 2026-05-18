// Ambient declaration so moduleResolution:node can find meilisearch types.
// meilisearch v0.58+ exposes types only via the package exports field,
// which requires node16/nodenext/bundler resolution. This shim bridges the gap.
declare module 'meilisearch' {
  export * from 'meilisearch/dist/index';
  export { default } from 'meilisearch/dist/index';
}
