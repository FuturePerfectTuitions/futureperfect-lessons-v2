const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="theme-color" content="#012169" />
  <title>Future Perfect Tuitions</title>
  <style>
    :root{
      font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      color:#13213a;background:#f4f6f8;font-synthesis:none;
      --navy:#012169;--navy-2:#153b86;--red:#c8102e;--ink:#14213d;--muted:#667085;
      --line:#d9e0ea;--white:#fff;--shadow:0 18px 54px rgba(13,34,72,.12);
    }
    *{box-sizing:border-box}
    html,body{min-height:100%;margin:0}
    html{background:#f4f6f8}
    body{
      min-width:320px;
      background:radial-gradient(circle at top,#fff 0,#f4f6f8 42rem);
      color:var(--ink);
    }
    body::before{
      content:"";position:fixed;z-index:1000;pointer-events:none;inset:0;border:6px solid transparent;
      border-image:repeating-linear-gradient(135deg,var(--red) 0 18px,#fff 18px 34px,var(--navy) 34px 52px,#fff 52px 68px) 6;
    }
    .shell{min-height:100vh;display:grid;grid-template-rows:auto 1fr auto}
    .topbar{
      min-height:82px;background:rgba(255,255,255,.94);backdrop-filter:blur(12px);
      border-bottom:1px solid rgba(217,224,234,.9);display:flex;align-items:center;
      padding:12px clamp(22px,4vw,58px);box-shadow:0 8px 24px rgba(13,34,72,.05)
    }
    .brand{display:inline-flex;align-items:center;text-decoration:none;color:var(--navy);font-weight:800}
    .brand img{width:min(238px,46vw);height:50px;object-fit:contain;object-position:left center}
    .main{width:min(1120px,calc(100% - 40px));margin:0 auto;padding:clamp(28px,5vw,58px) 0}
    .card{
      position:relative;background:var(--white);border:1px solid var(--line);border-radius:26px;
      box-shadow:var(--shadow);padding:clamp(24px,4vw,46px);overflow:visible
    }
    .portal-card{border-top:5px solid var(--navy)}
    .eyebrow{margin:0 0 8px;color:var(--red);font-size:.76rem;font-weight:950;letter-spacing:.13em;text-transform:uppercase}
    h1,h2,p{margin-top:0}
    h1{color:var(--navy);font-size:clamp(2rem,5vw,3.05rem);line-height:1.04;margin-bottom:12px}
    h2{color:var(--navy)}
    .resource-section{border-top:1px solid var(--line);padding:20px 0 0}
    .resource-section-heading{margin-bottom:16px}
    .resource-section-heading h2{margin:3px 0 0}
    .player-frame{
      width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:16px;background:#09152c;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)
    }
    .player-frame iframe{display:block;width:100%;height:100%;border:0;background:#09152c}
    .footer{padding:22px 16px 34px;text-align:center;color:#667085;font-size:.9rem}
    @media (max-width:720px){
      body::before{border-width:5px}
      .topbar{min-height:68px;padding:10px 18px}
      .brand img{width:156px;height:42px}
      .main{width:min(100% - 24px,1120px);padding:22px 0 34px}
      .card{border-radius:20px;padding:22px 17px}
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="https://www.futureperfect.education/" aria-label="Future Perfect Tuitions">
        <img src="https://www.futureperfect.education/assets/fpt-logo.png" alt="Future Perfect Tuitions" />
      </a>
    </header>
    <main class="main">
      <section class="card portal-card">
        <p class="eyebrow">Future Perfect Tuitions</p>
        <h1>Welcome</h1>
        <section class="resource-section video-section">
          <div class="resource-section-heading">
            <p class="eyebrow">Watch our introduction</p>
            <h2>Future Perfect Tuitions</h2>
          </div>
          <div class="player-frame">
            <iframe
              id="marketing-player"
              title="Future Perfect Tuitions introduction"
              src="https://go.screenpal.com/player/cO61ifnxHQI?ff=1&ahc=1&dcc=1&tl=1&bg=transparent"
              allow="fullscreen; picture-in-picture"
              allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin">
            </iframe>
          </div>
        </section>
      </section>
    </main>
    <footer class="footer">Future Perfect Tuitions</footer>
  </div>
  <!-- FPT_MARKETING_VIDEO_226_V1 -->
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' }
      });
    }

    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers({
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': "default-src 'none'; frame-src https://go.screenpal.com; img-src https://www.futureperfect.education data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });

    return new Response(request.method === 'HEAD' ? null : HTML, { status: 200, headers });
  }
};
