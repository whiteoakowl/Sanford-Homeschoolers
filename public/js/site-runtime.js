// Public-site behaviors for pages built in the Wix-style site editor
// (views/public-home.ejs): entrance animations, slideshows, tabs, the
// mobile hamburger menu, and the cookie notice. Everything renders and
// works without this file (animations only hide content once the
// html.wx-js class is present, tabs fall back to showing every panel).
(function () {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Entrance animations - scroll-triggered by default, or on page load.
  const animated = Array.from(document.querySelectorAll('.wx-anim'));
  if (reduce || !('IntersectionObserver' in window)) {
    animated.forEach((el) => el.classList.add('wx-in'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('wx-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    animated.forEach((el) => {
      if (el.getAttribute('data-anim-trigger') === 'load') requestAnimationFrame(() => el.classList.add('wx-in'));
      else io.observe(el);
    });
  }

  // Slideshows.
  document.querySelectorAll('.wx-slideshow').forEach((show) => {
    const slides = Array.from(show.querySelectorAll('.wx-slide'));
    if (slides.length < 2) return;
    let i = 0;
    function go(n) {
      slides[i].classList.remove('is-active');
      slides[i].hidden = true;
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('is-active');
      slides[i].hidden = false;
    }
    const prev = show.querySelector('.wx-slide-prev');
    const next = show.querySelector('.wx-slide-next');
    if (prev) prev.addEventListener('click', () => go(i - 1));
    if (next) next.addEventListener('click', () => go(i + 1));
    const secs = parseInt(show.getAttribute('data-autoplay'), 10);
    if (secs > 0 && !reduce) {
      let timer = setInterval(() => go(i + 1), secs * 1000);
      show.addEventListener('mouseenter', () => clearInterval(timer));
      show.addEventListener('focusin', () => clearInterval(timer));
      show.addEventListener('mouseleave', () => {
        clearInterval(timer);
        timer = setInterval(() => go(i + 1), secs * 1000);
      });
    }
  });

  // Tabs (WAI-ARIA tabs pattern, arrow keys move between tabs).
  document.querySelectorAll('.wx-tabs').forEach((box) => {
    const tabs = Array.from(box.querySelectorAll('[role="tab"]'));
    const panels = Array.from(box.querySelectorAll('[role="tabpanel"]'));
    panels.forEach((p) => {
      if (p.hasAttribute('data-wx-hidden')) p.hidden = true;
    });
    function select(n) {
      tabs.forEach((t, k) => {
        t.setAttribute('aria-selected', String(k === n));
        t.tabIndex = k === n ? 0 : -1;
        panels[k].hidden = k !== n;
      });
      tabs[n].focus();
    }
    tabs.forEach((t, k) => {
      t.addEventListener('click', () => select(k));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') select((k + 1) % tabs.length);
        else if (e.key === 'ArrowLeft') select((k - 1 + tabs.length) % tabs.length);
      });
    });
  });

  // Mobile hamburger menu.
  const burger = document.querySelector('.wx-burger');
  if (burger) {
    const header = burger.closest('.wx-header');
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') !== 'true';
      burger.setAttribute('aria-expanded', String(open));
      header.classList.toggle('menu-open', open);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && header.classList.contains('menu-open')) {
        header.classList.remove('menu-open');
        burger.setAttribute('aria-expanded', 'false');
        burger.focus();
      }
    });
  }
  // Touch devices have no hover - a tap on a dropdown parent opens it.
  document.querySelectorAll('.wx-menu .has-sub > a, .wx-menu .has-sub > .wx-menu-folder').forEach((a) => {
    a.addEventListener('click', (e) => {
      const li = a.parentElement;
      if (window.matchMedia('(hover: none)').matches && !li.classList.contains('sub-open')) {
        e.preventDefault();
        li.classList.add('sub-open');
      }
    });
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && a.classList.contains('wx-menu-folder')) a.parentElement.classList.toggle('sub-open');
    });
  });

  // Transparent header: solid once the visitor scrolls.
  const tHeader = document.querySelector('.wx-header.is-transparent');
  if (tHeader) {
    const onScroll = () => tHeader.classList.toggle('is-scrolled', window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Cookie notice - remembered per browser.
  const cookie = document.querySelector('[data-wx-cookie]');
  if (cookie) {
    let accepted;
    try {
      accepted = localStorage.getItem('wx-cookie-ok') === '1';
    } catch (err) {
      accepted = false;
    }
    if (!accepted) cookie.hidden = false;
    const btn = cookie.querySelector('[data-wx-cookie-accept]');
    btn.addEventListener('click', () => {
      cookie.hidden = true;
      try {
        localStorage.setItem('wx-cookie-ok', '1');
      } catch (err) {
        // Private mode - it'll just ask again next visit.
      }
    });
  }
})();
