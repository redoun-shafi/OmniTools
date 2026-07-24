const tools = [
  { name: 'DOCX to XLSX', description: 'Turn recipe documents into clean Excel workbooks, ready to sort and share.', category: 'Converters', icon: 'X', color: '#2563eb', status: 'Ready', href: 'tools/docx-to-xlsx/' },
  { name: 'Recipe Index', description: 'Search, filter, organize, and export your personal recipe collection.', category: 'AI Tools', icon: 'R', color: '#ea580c', status: 'Ready', href: 'tools/recipe-generator/' },
  { name: 'Flow Automator', description: 'Queue prompts and automate bulk image generation with the Chrome extension.', category: 'Extensions', icon: 'F', color: '#7c3aed', status: 'Extension', href: 'tools/flow-automator/' },
  { name: 'CSV Cleaner', description: 'Prepare messy spreadsheet data for your next workflow in a few clicks.', category: 'Converters', icon: 'C', color: '#059669', status: 'Coming soon', href: '#' },
  { name: 'Prompt Builder', description: 'Shape clear, reusable prompts for the way you work and create.', category: 'AI Tools', icon: 'P', color: '#0891b2', status: 'Coming soon', href: '#' },
  { name: 'OCR Extractor', description: 'Pull useful text from images and scanned documents without the busywork.', category: 'AI Tools', icon: 'O', color: '#db2777', status: 'Coming soon', href: '#' }
];

const grid = document.querySelector('#toolGrid');
const search = document.querySelector('#toolSearch');
const count = document.querySelector('#toolCount');
const emptyState = document.querySelector('#emptyState');
let activeCategory = 'All';

function renderTools() {
  const query = search.value.trim().toLowerCase();
  const visible = tools.filter(tool => {
    const matchesCategory = activeCategory === 'All' || tool.category === activeCategory;
    const searchable = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
    return matchesCategory && searchable.includes(query);
  });

  grid.innerHTML = visible.map(tool => `
    <article class="tool-card" style="--tool-color:${tool.color}">
      <div class="card-top">
        <div class="tool-icon" aria-hidden="true">${tool.icon}</div>
        <span class="tool-status ${tool.status === 'Coming soon' ? 'coming-soon' : ''}">${tool.status}</span>
      </div>
      <h3>${tool.name}</h3>
      <p>${tool.description}</p>
      <div class="tool-card-footer">
        <span class="tool-category">${tool.category}</span>
        ${tool.status === 'Coming soon' ? '<span class="tool-coming">Coming soon</span>' : `<a class="tool-open" href="${tool.href}">Open tool</a>`}
      </div>
    </article>
  `).join('');

  count.textContent = `${visible.length} ${visible.length === 1 ? 'tool' : 'tools'}`;
  emptyState.hidden = visible.length !== 0;
}

document.querySelectorAll('.category-button').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.category-button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    activeCategory = button.dataset.category;
    renderTools();
  });
});

search.addEventListener('input', renderTools);
document.addEventListener('keydown', event => {
  if (event.key === '/' && document.activeElement !== search) {
    event.preventDefault();
    search.focus();
  }
});

const themeSelect = document.querySelector('#themeSelect');
const savedTheme = localStorage.getItem('omniToolsTheme') || 'light';
document.documentElement.dataset.theme = savedTheme;
themeSelect.value = savedTheme;
themeSelect.addEventListener('change', event => {
  const theme = event.target.value;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('omniToolsTheme', theme);
});

const menuToggle = document.querySelector('#menuToggle');
const mobileMenu = document.querySelector('#mobileMenu');
menuToggle.addEventListener('click', () => {
  const isOpen = mobileMenu.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
});
mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  mobileMenu.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');
}));

renderTools();
