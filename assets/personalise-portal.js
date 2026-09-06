(() => {
  const portalScreen = document.getElementById('portal-screen');
  const greeting = document.getElementById('student-greeting');
  if (!portalScreen || !greeting) return;

  const defaultTitle = document.title;
  const portalTextNodes = [];
  const walker = document.createTreeWalker(portalScreen, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const value = String(walker.currentNode.nodeValue || '');
    if (value.includes('Student Portal')) {
      portalTextNodes.push({ node: walker.currentNode, original: value });
    }
  }

  function setPortalLabel(firstName = '') {
    const owner = String(firstName || '').trim();
    const replacement = owner ? `${owner}'s Portal` : 'Student Portal';

    for (const entry of portalTextNodes) {
      entry.node.nodeValue = entry.original.replaceAll('Student Portal', replacement);
    }

    document.title = owner
      ? defaultTitle.replaceAll('Student Portal', replacement)
      : defaultTitle;
  }

  function readFirstName() {
    const text = String(greeting.textContent || '').trim();
    const match = text.match(/^Hi,\s*(.+)$/i);
    if (!match) return '';
    const firstName = String(match[1] || '').trim();
    return firstName === '!' ? '' : firstName;
  }

  function sync() {
    if (portalScreen.hidden) {
      setPortalLabel();
      return;
    }
    const firstName = readFirstName();
    if (firstName) setPortalLabel(firstName);
  }

  const observer = new MutationObserver(sync);
  observer.observe(greeting, { childList: true, characterData: true, subtree: true });
  observer.observe(portalScreen, { attributes: true, attributeFilter: ['hidden'] });
  sync();
})();
