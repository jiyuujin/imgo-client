/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
  COMPRESS_API_URL: string;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/upload') {
      const cloudRunUrl = env.COMPRESS_API_URL;
      if (!cloudRunUrl) return new Response('COMPRESS_API_URL not set', { status: 500 });
      return await fetch(cloudRunUrl, request);
    }

    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  },
} satisfies ExportedHandler<Env>;

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>IMGO - Compress Images</title>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-F757PCNJSX"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-F757PCNJSX');
  </script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7095980629133842"
     crossorigin="anonymous"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/libheif-js@1.17.1/libheif-bundle.js"></script>
  <style>
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
    @keyframes slide { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
    .indeterminate { animation: slide 1.2s ease-in-out infinite; }
    #dropZone.dragover { border-color: #3b82f6; background-color: #eff6ff; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen p-6 md:p-12 text-gray-800 font-sans">
  <div class="max-w-4xl mx-auto">
    <header class="text-center mb-10">
      <h1 class="text-3xl font-black text-gray-900 tracking-tight italic">IMGO</h1>
      <p class="text-gray-500 mt-2 font-medium">PNG / JPG / HEIC / NEF 対応 高速圧縮</p>
    </header>

    <div id="dropZone" class="border-4 border-dashed border-gray-200 rounded-3xl p-12 text-center bg-white transition-all cursor-pointer shadow-sm">
      <div class="space-y-4 pointer-events-none">
        <div class="text-5xl">📸</div>
        <p class="text-lg font-bold text-gray-700">画像をここにドロップ</p>
        <p class="text-sm text-gray-400 italic">iPhoneのHEIC形式もそのままOK</p>
        <p class="text-xs text-gray-400">クリックして選択 ・ 貼り付け（Ctrl / ⌘ + V）も使えます</p>
      </div>
      <input type="file" id="fileInput" multiple accept="image/*,.nef" class="hidden">
    </div>

    <div id="panel" class="hidden mt-8 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div class="flex items-baseline justify-between gap-4">
        <div id="status" class="text-sm font-bold text-blue-600" aria-live="polite"></div>
        <div id="percent" class="text-sm font-black text-gray-900 tabular-nums"></div>
      </div>
      <div id="overallTrack" class="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div id="overallBar" class="h-full bg-blue-500 rounded-full transition-all duration-200" style="width:0%"></div>
      </div>
      <div id="savings" class="mt-2 text-xs text-gray-400"></div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button id="zipBtn" onclick="downloadAll()" class="hidden bg-gray-900 text-white px-8 py-3 rounded-full font-bold hover:bg-black transition-all shadow-xl active:scale-95 disabled:opacity-60">
          すべての画像をZIPで保存
        </button>
        <button id="stopBtn" class="hidden text-sm font-bold text-red-500 border border-red-200 px-5 py-2.5 rounded-full hover:bg-red-50 transition-all">
          すべて停止
        </button>
        <button id="clearBtn" class="hidden text-sm font-bold text-gray-500 border border-gray-200 px-5 py-2.5 rounded-full hover:bg-gray-50 transition-all">
          クリア
        </button>
      </div>
    </div>

    <div id="list" class="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"></div>
  </div>

  <script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const list = document.getElementById('list');
    const panel = document.getElementById('panel');
    const status = document.getElementById('status');
    const percentEl = document.getElementById('percent');
    const overallTrack = document.getElementById('overallTrack');
    const overallBar = document.getElementById('overallBar');
    const savingsEl = document.getElementById('savings');
    const zipBtn = document.getElementById('zipBtn');
    const stopBtn = document.getElementById('stopBtn');
    const clearBtn = document.getElementById('clearBtn');

    const ZIP_LABEL = 'すべての画像をZIPで保存';
    const BASE_TITLE = document.title;

    const ICON = { queued: '⏳', converting: '🔄', uploading: '📤', processing: '⚙️', downloading: '📥', error: '⚠️', cancelled: '⏹' };
    const STATE_TEXT = { queued: '待機中', converting: 'HEIC変換中', uploading: '送信中', processing: 'サーバー処理中', downloading: '受信中', cancelled: '中止しました' };

    let decoder = null;
    let items = [];
    let queue = [];
    let running = false;
    let wakeLock = null;
    let seq = 0;

    window.onload = function() {
      if (window.libheif) {
        decoder = new window.libheif.HeifDecoder();
      }
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(name) {
      dropZone.addEventListener(name, function(e) {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    dropZone.addEventListener('dragover', function() { dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', function(e) {
      dropZone.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });

    window.addEventListener('dragover', function(e) { e.preventDefault(); });
    window.addEventListener('drop', function(e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });

    document.addEventListener('paste', function(e) {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(function(f) {
        return f.type.indexOf('image/') === 0;
      });
      if (files.length) {
        e.preventDefault();
        handleFiles(files);
      }
    });

    dropZone.onclick = function() { fileInput.click(); };
    fileInput.onchange = function(e) {
      handleFiles(e.target.files);
      e.target.value = '';
    };

    stopBtn.onclick = function() { stopAll(); };
    clearBtn.onclick = function() { clearAll(); };

    window.addEventListener('beforeunload', function(e) {
      if (running) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    async function acquireWakeLock() {
      try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
    function releaseWakeLock() {
      try {
        if (wakeLock) { wakeLock.release(); wakeLock = null; }
      } catch (e) {}
    }
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && running && !wakeLock) acquireWakeLock();
    });

    function fmtSize(bytes) {
      if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + 'MB';
      return Math.max(1, Math.round(bytes / 1024)) + 'KB';
    }

    function fmtDelta(inBytes, outBytes) {
      if (!inBytes) return '';
      const d = Math.round((1 - outBytes / inBytes) * 100);
      return d >= 0 ? '-' + d + '%' : '+' + (-d) + '%';
    }

    function makeBtn(text, cls, onclick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.onclick = onclick;
      return b;
    }

    function createCard(item) {
      const root = document.createElement('div');
      root.className = "bg-white p-2 rounded-2xl shadow-sm border border-gray-100 animate-fade-in text-center";

      const thumb = document.createElement('div');
      thumb.className = "w-full h-32 rounded-xl mb-2 bg-gray-50 overflow-hidden flex items-center justify-center";
      const ph = document.createElement('div');
      ph.className = "flex flex-col items-center text-gray-500";
      const icon = document.createElement('div');
      icon.className = "text-3xl";
      const pct = document.createElement('div');
      pct.className = "text-xl font-black tabular-nums";
      ph.appendChild(icon);
      ph.appendChild(pct);
      thumb.appendChild(ph);

      const nameEl = document.createElement('p');
      nameEl.className = "text-[10px] text-gray-500 truncate mb-1";
      nameEl.textContent = item.file.name;
      nameEl.title = item.file.name;

      const infoEl = document.createElement('p');
      infoEl.className = "text-[10px] text-gray-400 mb-1";

      const track = document.createElement('div');
      track.className = "h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2";
      const bar = document.createElement('div');
      bar.className = "h-full rounded-full bg-blue-500";
      track.appendChild(bar);

      const actions = document.createElement('div');
      actions.className = "flex justify-center gap-3 text-xs font-bold min-h-[1.25rem]";

      root.appendChild(thumb);
      root.appendChild(nameEl);
      root.appendChild(infoEl);
      root.appendChild(track);
      root.appendChild(actions);

      return { root: root, thumb: thumb, ph: ph, icon: icon, pct: pct, infoEl: infoEl, bar: bar, actions: actions, img: null, lastState: '' };
    }

    function rebuildActions(item) {
      const e = item.el;
      const s = item.state;
      const active = s === 'converting' || s === 'uploading' || s === 'processing' || s === 'downloading';
      e.actions.textContent = '';

      if (s === 'queued') {
        e.actions.appendChild(makeBtn('キャンセル', 'text-gray-500 hover:underline', function() { cancelItem(item); }));
      } else if (active) {
        e.actions.appendChild(makeBtn('中止', 'text-gray-500 hover:underline', function() { cancelItem(item); }));
      } else if (s === 'done') {
        const a = document.createElement('a');
        a.href = item.url;
        a.download = 'min_' + item.outName;
        a.className = 'text-blue-500 hover:underline';
        a.textContent = '保存';
        e.actions.appendChild(a);
      } else if (s === 'error' || s === 'cancelled') {
        e.actions.appendChild(makeBtn('再送', 'text-blue-500 hover:underline', function() { retryItem(item); }));
        e.actions.appendChild(makeBtn('削除', 'text-gray-400 hover:underline', function() { removeItem(item); }));
      }
    }

    function renderItem(item) {
      const e = item.el;
      const s = item.state;

      // サムネイル / 進捗
      e.ph.classList.toggle('hidden', s === 'done');
      if (s === 'done') {
        if (!e.img) {
          const img = document.createElement('img');
          img.src = item.url;
          img.decoding = 'async';
          img.className = "w-full h-full object-cover";
          e.thumb.appendChild(img);
          e.img = img;
        }
      } else {
        e.icon.textContent = ICON[s] || '';
        e.icon.classList.toggle('animate-pulse', s === 'converting' || s === 'processing');
        e.pct.textContent = (s === 'uploading' || s === 'downloading') ? Math.round(item.frac * 100) + '%' : '';
      }

      // 進捗
      let color = 'bg-blue-500';
      if (s === 'done') color = 'bg-green-500';
      else if (s === 'error') color = 'bg-red-400';
      else if (s === 'cancelled') color = 'bg-gray-300';
      if (item.indeterminate) {
        e.bar.className = 'h-full w-1/3 rounded-full indeterminate ' + color;
        e.bar.style.width = '';
      } else {
        e.bar.className = 'h-full rounded-full transition-all duration-200 ' + color;
        e.bar.style.width = ((s === 'done' || s === 'error') ? 100 : Math.round(item.frac * 100)) + '%';
      }

      // 情報の行
      if (s === 'done') {
        e.infoEl.className = "text-[10px] text-gray-400 mb-1";
        e.infoEl.textContent = fmtSize(item.file.size) + ' → ' + fmtSize(item.blob.size) + ' (' + fmtDelta(item.file.size, item.blob.size) + ')';
      } else if (s === 'error') {
        e.infoEl.className = "text-[10px] text-red-500 font-bold mb-1";
        e.infoEl.textContent = item.error;
      } else {
        e.infoEl.className = "text-[10px] text-gray-400 mb-1";
        let text = fmtSize(item.file.size) + ' ・ ' + (STATE_TEXT[s] || '');
        if (s === 'processing' && item.isRaw) text += '（RAW現像）';
        e.infoEl.textContent = text;
      }

      if (e.lastState !== s) {
        e.lastState = s;
        rebuildActions(item);
      }
    }

    function setItem(item, state, frac, indeterminate) {
      item.state = state;
      if (typeof frac === 'number') item.frac = frac;
      item.indeterminate = !!indeterminate;
      renderItem(item);
      updateOverall();
    }

    function updateOverall() {
      panel.classList.toggle('hidden', !items.length);

      const live = items.filter(function(i) { return i.state !== 'cancelled'; });
      let totalW = 0, doneW = 0, finished = 0, ok = 0, err = 0, sumIn = 0, sumOut = 0;
      live.forEach(function(i) {
        const w = Math.max(i.file.size, 1);
        const fin = i.state === 'done' || i.state === 'error';
        totalW += w;
        doneW += w * (fin ? 1 : i.frac);
        if (fin) finished++;
        if (i.state === 'done') { ok++; sumIn += i.file.size; sumOut += i.blob.size; }
        if (i.state === 'error') err++;
      });
      const pct = totalW ? Math.round(doneW / totalW * 100) : 0;

      if (running) {
        status.textContent = '処理中 ' + finished + ' / ' + live.length + ' 枚';
        document.title = '(' + finished + '/' + live.length + ') ' + BASE_TITLE;
      } else {
        document.title = BASE_TITLE;
        if (live.length) status.textContent = '完了 (成功: ' + ok + '枚' + (err ? ' / 失敗: ' + err + '枚' : '') + ')';
        else status.textContent = '中止しました';
      }

      percentEl.textContent = live.length ? pct + '%' : '';
      overallBar.style.width = pct + '%';
      overallBar.className = 'h-full rounded-full transition-all duration-200 ' + ((!running && live.length && !err) ? 'bg-green-500' : 'bg-blue-500');
      overallTrack.setAttribute('aria-valuenow', String(pct));

      savingsEl.textContent = ok ? '元サイズ合計 ' + fmtSize(sumIn) + ' → ' + fmtSize(sumOut) + ' (' + fmtDelta(sumIn, sumOut) + ')' : '';

      zipBtn.classList.toggle('hidden', ok === 0);
      stopBtn.classList.toggle('hidden', !(running || queue.length));
      clearBtn.classList.toggle('hidden', running || !items.length);
    }

    function cancelItem(item) {
      if (item.state === 'queued') {
        queue = queue.filter(function(q) { return q !== item; });
        setItem(item, 'cancelled', 0);
        return;
      }
      item.cancelled = true;
      if (item.xhr) item.xhr.abort();
    }

    function stopAll() {
      queue.slice().forEach(cancelItem);
      items.forEach(function(i) {
        if (i.xhr || i.state === 'converting') cancelItem(i);
      });
    }

    function retryItem(item) {
      item.frac = 0;
      item.error = '';
      setItem(item, 'queued', 0);
      queue.push(item);
      runQueue();
    }

    function removeItem(item) {
      items = items.filter(function(i) { return i !== item; });
      queue = queue.filter(function(q) { return q !== item; });
      if (item.url) URL.revokeObjectURL(item.url);
      item.el.root.remove();
      updateOverall();
    }

    function clearAll() {
      items.forEach(function(i) { if (i.url) URL.revokeObjectURL(i.url); });
      items = [];
      queue = [];
      list.textContent = '';
      updateOverall();
    }

    async function convertHeicToJpg(file) {
      if (!decoder) throw new Error("Decoder not ready");

      const buffer = await file.arrayBuffer();
      const images = decoder.decode(new Uint8Array(buffer));

      const image = images[0];
      const width = image.get_width();
      const height = image.get_height();

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(width, height);

      return new Promise(function(resolve) {
        image.display(imgData, function(displayData) {
          ctx.putImageData(displayData, 0, 0);
          canvas.toBlob(resolve, 'image/jpeg', 0.9);
        });
      });
    }

    function httpMessage(code) {
      if (code === 400) return '画像を読み込めませんでした（未対応の形式の可能性）';
      if (code === 413) return 'ファイルが大きすぎます';
      if (code === 0) return '通信エラー';
      return 'サーバーエラー (' + code + ')';
    }

    // 進捗の配分: 送信 0-80% / サーバー処理 80% で待機 / 受信 80-100%
    function sendFile(item, uploadFile) {
      return new Promise(function(resolve, reject) {
        const formData = new FormData();
        formData.append('file', uploadFile);

        const xhr = new XMLHttpRequest();
        item.xhr = xhr;
        xhr.open('POST', '/upload');
        xhr.responseType = 'blob';

        xhr.upload.onprogress = function(e) {
          if (e.lengthComputable && e.total) setItem(item, 'uploading', 0.8 * e.loaded / e.total);
        };
        xhr.upload.onload = function() {
          setItem(item, 'processing', 0.8, true);
        };
        xhr.onprogress = function(e) {
          if (e.lengthComputable && e.total) setItem(item, 'downloading', 0.8 + 0.2 * e.loaded / e.total);
          else setItem(item, 'downloading', 0.8, true);
        };
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300 && xhr.response && xhr.response.size) resolve(xhr.response);
          else reject(new Error(httpMessage(xhr.status)));
        };
        xhr.onerror = function() { reject(new Error('通信エラー')); };
        xhr.onabort = function() { reject({ cancelled: true }); };
        xhr.send(formData);
      });
    }

    async function processItem(item) {
      item.cancelled = false;
      item.error = '';
      let uploadFile = item.file;

      if (item.file.name.toLowerCase().endsWith('.heic')) {
        setItem(item, 'converting', 0, true);
        try {
          const jpgBlob = await convertHeicToJpg(item.file);
          uploadFile = new File([jpgBlob], item.file.name.replace(/\\.heic$/i, ".jpg"), { type: "image/jpeg" });
        } catch (e) {
          console.error("HEIC Error:", e);
          item.error = 'HEIC変換に失敗しました';
          setItem(item, 'error', 1);
          return;
        }
        if (item.cancelled) {
          setItem(item, 'cancelled', 0);
          return;
        }
      }

      setItem(item, 'uploading', 0);
      try {
        const blob = await sendFile(item, uploadFile);
        const ext = blob.type === 'image/webp' ? '.webp' : '.jpg';
        item.outName = uploadFile.name.replace(/\\.[^.]+$/, '') + ext;
        item.blob = blob;
        item.url = URL.createObjectURL(blob);
        setItem(item, 'done', 1);
      } catch (err) {
        if (err && err.cancelled) {
          setItem(item, 'cancelled', 0);
        } else {
          console.error(err);
          item.error = (err && err.message) || '通信エラー';
          setItem(item, 'error', 1);
        }
      } finally {
        item.xhr = null;
      }
    }

    async function runQueue() {
      if (running) return;
      running = true;
      await acquireWakeLock();
      updateOverall();
      while (queue.length) {
        const item = queue.shift();
        if (item.state !== 'queued') continue;
        await processItem(item);
      }
      running = false;
      releaseWakeLock();
      updateOverall();
    }

    function handleFiles(files) {
      const fileList = Array.from(files);
      if (!fileList.length) return;

      // 送信前に合計サイズを確認し、回線が弱そうなら確認する
      const totalBytes = fileList.reduce(function(sum, f) { return sum + f.size; }, 0);
      const totalMB = (totalBytes / 1048576).toFixed(1);
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const weakNetwork = conn && (
        conn.saveData ||
        conn.type === 'cellular' ||
        (conn.effectiveType && conn.effectiveType !== '4g')
      );
      if (weakNetwork && totalBytes >= 20 * 1048576) {
        const ok = confirm("モバイル回線または低速回線の可能性があります。合計 " + totalMB + "MB をアップロードしますが、続行しますか？");
        if (!ok) return;
      }

      fileList.forEach(function(file) {
        const item = {
          id: ++seq,
          file: file,
          isRaw: file.name.toLowerCase().endsWith('.nef'),
          state: 'queued',
          frac: 0,
          indeterminate: false,
          error: '',
          blob: null,
          url: null,
          outName: '',
          xhr: null,
          cancelled: false,
          el: null
        };
        item.el = createCard(item);
        items.push(item);
        queue.push(item);
        list.appendChild(item.el.root);
        renderItem(item);
      });

      updateOverall();
      runQueue();
    }

    async function downloadAll() {
      const done = items.filter(function(i) { return i.state === 'done'; });
      if (!done.length) return;

      const zip = new JSZip();
      done.forEach(function(f, i) {
        zip.file(i + "_" + f.outName, f.blob);
      });

      zipBtn.disabled = true;
      try {
        // 画像はすでに圧縮済みのため、無圧縮（STORE）で速くまとめる
        const content = await zip.generateAsync({ type: "blob", compression: "STORE" }, function(meta) {
          zipBtn.textContent = 'ZIP作成中 ' + Math.round(meta.percent) + '%';
        });
        const link = document.createElement("a");
        const zipUrl = URL.createObjectURL(content);
        link.href = zipUrl;
        link.download = "images.zip";
        link.click();
        setTimeout(function() { URL.revokeObjectURL(zipUrl); }, 60000);
      } finally {
        zipBtn.disabled = false;
        zipBtn.textContent = ZIP_LABEL;
      }
    }
  </script>
</body>
</html>
`;
