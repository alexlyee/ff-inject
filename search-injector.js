/* Foam Factory AI Search — storefront DOM injector.
   Runs on every page via the head_tag resource group. On SRCH pages, fetches
   AI-ranked results from the Tailscale-funneled backend and replaces Miva's
   native product list with AI hits using Miva's own .x-product-list markup.
   Categories and Miva pages surface alongside products; each hit renders with
   a type badge so customers can tell products apart from categories apart from
   resource pages at a glance. */
(function(){
  var API = 'https://a-foamfactory-workstation.tail1178b.ts.net/search';

  // Inline SVG placeholder (data URI). Branded gray gradient tile — stands in
  // for real product photos until per-product AI-generated imagery lands
  // (FLUX.1-schnell on the Ascent, planned). Using a data URI means no
  // second HTTP request, no external dependency, no broken-image fallback.
  var PLACEHOLDER_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#eef1f6"/>' +
        '<stop offset="1" stop-color="#d0d6e0"/>' +
      '</linearGradient></defs>' +
      '<rect width="360" height="360" fill="url(%23g)"/>' +
      '<g fill="#fff" opacity="0.55"><circle cx="180" cy="160" r="64"/></g>' +
      '<text x="180" y="170" text-anchor="middle" ' +
        'font-family="system-ui,-apple-system,sans-serif" ' +
        'font-size="18" font-weight="600" fill="#5a6677">FF</text>' +
      '<text x="180" y="260" text-anchor="middle" ' +
        'font-family="system-ui,-apple-system,sans-serif" ' +
        'font-size="14" fill="#7a8699">Foam Factory</text>' +
    '</svg>';
  var PLACEHOLDER_URI =
    'data:image/svg+xml;utf8,' + encodeURIComponent(PLACEHOLDER_SVG);

  var BADGE_STYLES = {
    product:  'background:#e7f0ff;color:#2d6cdf;',
    category: 'background:#fff1e4;color:#c46a1e;',
    page:     'background:#e9f6ea;color:#2e8c3b;',
  };
  var BADGE_LABEL = { product: 'Product', category: 'Category', page: 'Page' };

  function onSearchPage(){
    return location.search.indexOf('Screen=SRCH') !== -1;
  }

  function getQuery(){
    var p = new URLSearchParams(location.search);
    return (p.get('Search') || '').trim();
  }

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  }); }

  function appendTrackingParam(href, hash){
    var sep = href.indexOf('?') === -1 ? '?' : '&';
    return href + sep + 'ff_q=' + encodeURIComponent(hash);
  }

  function buildHref(hit, hash){
    var base;
    if (hit.url_path) {
      base = (hit.url_path.indexOf('http') === 0)
        ? hit.url_path
        : 'https://www.competitivefoam.com' +
          (hit.url_path.charAt(0) === '/' ? '' : '/') + hit.url_path;
    } else {
      base = 'https://www.competitivefoam.com/mm5/merchant.mvc?Screen=PROD&Product_Code=' +
        encodeURIComponent(hit.code);
    }
    return appendTrackingParam(base, hash);
  }

  function cardHTML(hit, hash){
    var href = buildHref(hit, hash);
    var price = (hit.price && hit.price > 0) ? ('$' + Number(hit.price).toFixed(2)) : '';
    var type = hit.type || 'product';
    var badgeCss = 'display:inline-block;padding:2px 8px;border-radius:10px;' +
      'font-size:11px;font-weight:600;letter-spacing:.02em;margin-bottom:6px;' +
      (BADGE_STYLES[type] || BADGE_STYLES.product);
    var badgeText = BADGE_LABEL[type] || type;
    return '' +
      '<div class="o-layout__item u-text-center x-product-list__item" data-ai-rank="1" data-ai-type="' + esc(type) + '">' +
        '<a class="u-block x-product-list__link" href="' + href + '" title="' + esc(hit.name) + '">' +
          '<figure class="x-product-list__figure">' +
            '<img class="x-product-list__image" src="' + PLACEHOLDER_URI + '" alt="" loading="lazy" style="width:100%;height:auto;display:block;margin:0 auto" width="360" height="360">' +
            '<figcaption>' +
              '<span style="' + badgeCss + '">' + esc(badgeText) + '</span><br>' +
              '<strong class="x-product-list__name">' + esc(hit.name) + '</strong>' +
              (price ? '<span class="x-product-list__price">' + price + '</span>' : '') +
            '</figcaption>' +
          '</figure>' +
        '</a>' +
      '</div>';
  }

  function injectHits(hits, ffQ){
    if (!hits || !hits.length) return;
    var container = document.querySelector('section.x-product-list:not(.t-featured-products)');
    if (!container) {
      var noResults = Array.from(document.querySelectorAll('h2, h3, p, div'))
        .find(function(el){ return /no products matched/i.test(el.textContent || ''); });
      container = document.createElement('section');
      container.className = 'o-layout u-grids-2 u-grids-3--l x-product-list';
      if (noResults && noResults.parentNode) {
        noResults.parentNode.replaceChild(container, noResults);
      } else {
        var host = document.querySelector('main') || document.querySelector('#js-SRCH') || document.body;
        host.appendChild(container);
      }
    } else {
      container.innerHTML = '';
    }
    var banner = document.createElement('div');
    banner.className = 'o-layout__item u-width-12 u-text-center u-font-small';
    banner.style.cssText = 'padding:10px;background:#f7f9ff;border-left:3px solid #2d6cdf;margin-bottom:12px;color:#2d6cdf;';
    banner.textContent = 'AI-ranked results for "' + getQuery() + '" (' + hits.length + ' matches)';
    container.appendChild(banner);
    hits.forEach(function(h){
      var tmp = document.createElement('div');
      tmp.innerHTML = cardHTML(h, ffQ || '');
      container.appendChild(tmp.firstChild);
    });
  }

  function pingConversion(){
    // Runs on any page (PROD, BASK, OCNF, etc). If the current URL carries an
    // ff_q tracking hash, tell the backend which kind of post-search event
    // this is (view vs order). Backend joins the hash back to the original
    // query for downstream analysis.
    var p = new URLSearchParams(location.search);
    var h = p.get('ff_q');
    if (!h) return;
    var screen = (p.get('Screen') || '').toUpperCase();
    var event = 'view';
    if (screen === 'OCNF' || /invoice|order[-_ ]?confirmation/i.test(document.title)) {
      event = 'order';
    }
    var api = 'https://a-foamfactory-workstation.tail1178b.ts.net/log_conversion';
    try {
      // navigator.sendBeacon fire-and-forget so it survives page teardown
      // during checkout redirects.
      var data = JSON.stringify({ ff_q: h, event: event, screen: screen,
                                  url: location.href, ref: document.referrer });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(api, new Blob([data], {type: 'application/json'}));
      } else {
        fetch(api, { method: 'POST', body: data,
                     headers: {'Content-Type': 'application/json'},
                     keepalive: true });
      }
    } catch (e) { /* silent — tracking must never break the page */ }
  }

  function injectNoindex(){
    // Search result pages should not be indexed (Amy Heath, 4/23 SEO memo —
    // ?Search= URLs would create a duplicate-content / parameter-indexing
    // footprint). Client-side injection is belt-and-suspenders; the proper
    // fix is adding this to Miva's SRCH screen template server-side.
    if (document.querySelector('meta[name="robots"]')) return;
    var m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex,follow';
    document.head.appendChild(m);
  }

  function run(){
    pingConversion();
    if (!onSearchPage()) return;
    injectNoindex();
    var q = getQuery();
    if (!q) return;
    fetch(API, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      // No `types` filter — categories and blog/resource pages surface alongside
      // products per Carlo's 4/14 Path B spec and Amy Heath's 4/23 SEO note.
      body: JSON.stringify({ query: q, limit: 20 }),
    })
      .then(function(r){ return r.json(); })
      .then(function(data){ injectHits(data.hits || [], data.ff_q); })
      .catch(function(err){ console.warn('[foamfactory-ai] search failed:', err); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
