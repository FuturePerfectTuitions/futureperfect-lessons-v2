window.FPT_V2_CONFIG = Object.freeze({
  environment: "production",
  workerBaseUrl: "https://fpt-portal-v2-worker.futureperfectlessons.workers.dev"
});

document.write('<script src="assets/personalise-portal.js"></script>');

if (/\/phase11\.html$/.test(window.location.pathname)) {
  document.write('<script src="assets/phase11-vr-howto.js"></script>');
}
