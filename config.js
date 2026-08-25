window.FPT_V2_CONFIG = Object.freeze({
  environment: "development",
  workerBaseUrl: "https://fpt-portal-v2-worker.futureperfectlessons.workers.dev"
});

if (/\/phase11\.html$/.test(window.location.pathname)) {
  document.write('<script src="assets/phase11-vr-howto.js"></script>');
}
