// Deploy: npm run deploy:cloudflare. Upload the SFace model to R2 once per model change:
// npx wrangler@4 r2 object put kyc-lens-demo-assets/kyc-assets/matching/face_recognition_sface_2021dec.onnx --file demo/public/kyc-assets/matching/face_recognition_sface_2021dec.onnx --remote
// Serves the static playground; files above the 25 MiB asset limit come from R2 on the same origin,
// because the matching worker rejects cross-origin model URLs and redirects.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/kyc-assets/matching/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const object = await env.LARGE_ASSETS.get(pathname.slice(1));
      if (object) {
        const headers = new Headers({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', ETag: object.httpEtag, 'X-Content-Type-Options': 'nosniff' });
        return new Response(request.method === 'HEAD' ? null : object.body, { headers });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
