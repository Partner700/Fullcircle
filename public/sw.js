// Compatibility entry for browsers that still request the historic worker
// path. New releases register fc-worker.js directly because some hosts block
// the generic sw.js filename.
importScripts('./fc-worker.js?v=161');
