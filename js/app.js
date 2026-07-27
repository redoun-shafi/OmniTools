const tools = [
  { name: 'Canva Bulk Recipe Interior Converter', description: 'Convert recipe chapters into separate Excel interiors and match food images automatically.', category: 'Converters', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>', color: '#2563eb', status: 'Ready', href: 'tools/docx-to-xlsx/' },
  { name: 'Recipe Index Studio', description: 'Paste spreadsheet rows, preview a polished recipe index, and export it as a DOC file.', category: 'Converters', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>', color: '#ea580c', status: 'Ready', href: 'tools/recipe-generator/' },
  { name: 'Flow Automator', description: 'Queue prompts and automate bulk image generation with the Chrome extension.', category: 'Extensions', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>', color: '#7c3aed', status: 'Extension', href: 'tools/flow-automator/' },
  { name: 'CSV Cleaner', description: 'Prepare messy spreadsheet data for your next workflow in a few clicks.', category: 'Converters', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4"/></svg>', color: '#059669', status: 'Coming soon', href: '#' },
  { name: 'Prompt Builder', description: 'Shape clear, reusable prompts for the way you work and create.', category: 'AI Tools', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h14v12H8l-3 3z"/><path d="m9 9 2 2 4-4"/></svg>', color: '#0891b2', status: 'Coming soon', href: '#' },
  { name: 'OCR Extractor', description: 'Pull useful text from images and scanned documents without the busywork.', category: 'AI Tools', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M8 9h8v6H8z"/></svg>', color: '#db2777', status: 'Coming soon', href: '#' }
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
