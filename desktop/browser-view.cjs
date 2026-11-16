'use strict';

// Qoder Desktop 视图入口。宿主把这段代码注入 isolated world，container 位于
// Shadow DOM 内，require 只有 react 白名单，所以这里不 require 任何东西：
// 渲染结果由 node service 给出，样式在构建时内联成 STYLES。

const STYLES = '__OM_STYLES__';

const MERMAID_SELECTOR = 'pre > code.language-mermaid';
const POLL_MS = 1000;
const zh = /^zh/i.test(navigator.language || '');

function isDarkTheme() {
  const theme = document.documentElement.dataset.theme || '';
  return theme.endsWith('-dark');
}

function readableError(error) {
  return error && error.message ? error.message : String(error);
}

globalThis.qoderPluginView.register({
  mount(container, context) {
    const style = document.createElement('style');
    style.textContent = STYLES;

    const root = document.createElement('div');
    root.className = 'om-preview';
    root.classList.toggle('vscode-dark', isDarkTheme());

    // 药丸按钮相对 root 绝对定位，滚动放在独立的 .om-scroll 层，
    // 按钮才能始终浮在右上角，不随内容滚走。
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'om-pill';
    pill.textContent = zh ? '编辑' : 'Edit';
    pill.title = zh ? '回到官方原生编辑器' : 'Back to the native editor';

    const scroll = document.createElement('div');
    scroll.className = 'om-scroll';

    const status = document.createElement('div');
    status.className = 'om-status';

    const body = document.createElement('div');
    body.className = 'om-body';

    scroll.append(status, body);
    root.append(pill, scroll);
    container.append(style, root);

    const resource = context.resource;
    const filePath = resource && resource.path;
    let disposed = false;
    let version = null;
    let rendering = false;
    let mermaidState = 'idle';

    const themeObserver = new MutationObserver(() => {
      root.classList.toggle('vscode-dark', isDarkTheme());
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    function showStatus(message) {
      status.textContent = message || '';
      status.hidden = !message;
    }

    async function renderDiagram(code, index) {
      const mermaid = globalThis.__qoderPluginViewMermaidRuntime;
      if (!mermaid) { return; }
      const holder = document.createElement('div');
      holder.className = 'om-mermaid';
      const result = await mermaid.render('om-mermaid-' + index + '-' + Date.now(), code);
      holder.innerHTML = result.svg;
      return holder;
    }

    async function enhanceDiagrams() {
      const blocks = Array.from(body.querySelectorAll(MERMAID_SELECTOR));
      if (!blocks.length) { return; }
      if (mermaidState === 'idle') {
        mermaidState = 'loading';
        try {
          const host = globalThis.qoderPluginViewHost;
          if (host && typeof host.loadDiagramRuntime === 'function') { await host.loadDiagramRuntime(); }
        } catch { /* 宿主没提供图表运行时就保留源码 */ }
        mermaidState = 'ready';
      }
      if (!globalThis.__qoderPluginViewMermaidRuntime) { return; }
      for (let i = 0; i < blocks.length; i++) {
        const code = blocks[i];
        const pre = code.parentElement;
        if (!pre || !pre.isConnected) { continue; }
        try {
          const holder = await renderDiagram(code.textContent, i);
          if (holder && !disposed && pre.isConnected) { pre.replaceWith(holder); }
        } catch { /* 单个图失败不影响其余内容 */ }
      }
    }

    async function hydrateImage(img) {
      const target = img.getAttribute('data-om-img');
      if (!target) { return; }
      const parts = [];
      let offset = 0;
      let mime = 'image/png';
      try {
        for (;;) {
          if (disposed || !img.isConnected) { return; }
          const chunk = await context.api.node.callService('obsidianMarkdown', 'assetChunk', {
            note: filePath, path: target, offset
          });
          if (disposed || !img.isConnected) { return; }
          mime = chunk.mime;
          parts.push(chunk.data);
          if (chunk.next == null || chunk.next <= offset) { break; }
          offset = chunk.next;
        }
        img.src = 'data:' + mime + ';base64,' + parts.join('');
        img.removeAttribute('data-om-img');
      } catch (error) {
        // 单张图失败只标记该图，不影响整页预览。
        img.title = '图片加载失败：' + readableError(error);
      }
    }

    async function hydrateImages() {
      const imgs = Array.from(body.querySelectorAll('img[data-om-img]'));
      let cursor = 0;
      const worker = async () => {
        while (!disposed && cursor < imgs.length) { await hydrateImage(imgs[cursor++]); }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    }

    async function render(force) {
      if (disposed || rendering || !filePath) { return; }
      rendering = true;
      try {
        const result = await context.api.node.callService('obsidianMarkdown', 'render', {
          path: filePath,
          version: force ? null : version
        });
        if (disposed) { return; }
        if (result.unchanged) { return; }
        version = result.version;
        body.innerHTML = result.html;
        showStatus('');
        await Promise.all([hydrateImages(), enhanceDiagrams()]);
      } catch (error) {
        if (!disposed) { showStatus('预览失败：' + readableError(error)); }
      } finally {
        rendering = false;
      }
    }

    function onPillClick() {
      const win = context.api.window;
      if (!win || typeof win.showTextDocument !== 'function') {
        showStatus(zh ? '当前宿主版本不支持从预览打开原生编辑器。' : 'This host version cannot open the native editor from the preview.');
        return;
      }
      Promise.resolve(win.showTextDocument(filePath)).catch((error) => {
        if (!disposed) { showStatus((zh ? '打开编辑器失败：' : 'Failed to open editor: ') + readableError(error)); }
      });
    }

    function onClick(event) {
      const anchor = event.target.closest && event.target.closest('a');
      if (!anchor || !root.contains(anchor)) { return; }

      const local = anchor.getAttribute('data-om-open');
      if (local) {
        event.preventDefault();
        context.api.window.showFilePreview(local);
        return;
      }

      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#')) {
        // Shadow DOM 里浏览器不会自己跳 fragment，得手动滚。
        event.preventDefault();
        const id = decodeURIComponent(href.slice(1));
        const target = id && (root.querySelector('[id="' + CSS.escape(id) + '"]') || body.querySelector('#' + CSS.escape(id)));
        if (target) { target.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        return;
      }

      if (/^(https?|obsidian):/i.test(href)) {
        event.preventDefault();
        void context.api.node.callService('obsidianMarkdown', 'openExternal', { url: href }).catch(() => {});
      }
    }

    root.addEventListener('click', onClick);
    pill.addEventListener('click', onPillClick);

    if (!filePath) {
      pill.hidden = true;
      showStatus('没有可预览的文件。');
    } else {
      void render(true);
    }

    const sourceSubscription = context.api.files.onDidChangeSource(() => void render(false));
    const timer = resource && resource.refreshPolicy === 'live'
      ? setInterval(() => {
        if (context.api.lifecycle.isActive()) { void render(false); }
      }, POLL_MS)
      : null;

    return {
      dispose() {
        disposed = true;
        if (timer) { clearInterval(timer); }
        if (sourceSubscription && sourceSubscription.dispose) { sourceSubscription.dispose(); }
        themeObserver.disconnect();
        root.removeEventListener('click', onClick);
        pill.removeEventListener('click', onPillClick);
        root.remove();
        style.remove();
      }
    };
  }
});