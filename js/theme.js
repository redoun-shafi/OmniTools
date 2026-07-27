(function () {
  const themes = ['light', 'dark', 'emerald', 'ocean', 'royal', 'sunset', 'rose', 'midnight'];
  const select = document.querySelector('#themeSelect');
  const saved = localStorage.getItem('omniToolsTheme');
  const theme = themes.includes(saved) ? saved : 'light';

  function applyTheme(value) {
    const next = themes.includes(value) ? value : 'light';
    document.documentElement.dataset.theme = next;
    document.body?.classList.remove('dark');
    localStorage.setItem('omniToolsTheme', next);
    if (select) select.value = next;
  }

  applyTheme(theme);
  select?.addEventListener('change', event => applyTheme(event.target.value));
})();
