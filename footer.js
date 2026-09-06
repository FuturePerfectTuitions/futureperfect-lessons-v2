// Shared Future Perfect Tuitions portal footer: automatic year + legal links.
(function () {
  const year = new Date().getFullYear();
  const footers = document.querySelectorAll("[data-site-footer]");
  if (!footers.length) return;

  const markup = `
    <div class="footerInner">
      <div class="footerCopy">© Future Perfect Tuitions ${year}</div>
      <div class="footerLinks">
        <a href="privacy.html">Privacy</a>
        <span class="footerSep" aria-hidden="true">|</span>
        <a href="terms.html">Terms</a>
      </div>
    </div>
  `;

  footers.forEach((footer) => {
    footer.innerHTML = markup;
  });
})();
