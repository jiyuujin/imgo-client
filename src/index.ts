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
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/libheif-js@1.17.1/libheif-bundle.js"></script>
  <style>
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
    #dropZone.dragover { border-color: #3b82f6; background-color: #eff6ff; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen p-6 md:p-12 text-gray-800 font-sans">
  <div class="max-w-4xl mx-auto">
    <header class="text-center mb-10">
      <h1 class="text-3xl font-black text-gray-900 tracking-tight italic">IMGO</h1>
      <p class="text-gray-500 mt-2 font-medium">PNG / JPG / HEIC 対応 高速圧縮</p>
    </header>

    <div id="dropZone" class="border-4 border-dashed border-gray-200 rounded-3xl p-12 text-center bg-white transition-all cursor-pointer shadow-sm">
      <div class="space-y-4 pointer-events-none">
        <div class="text-5xl">📸</div>
        <p class="text-lg font-bold text-gray-700">画像をここにドロップ</p>
        <p class="text-sm text-gray-400 italic">iPhoneのHEIC形式もそのままOK</p>
      </div>
      <input type="file" id="fileInput" multiple accept="image/*" class="hidden">
    </div>

    <div class="mt-8 flex flex-col md:flex-row items-center justify-between gap-4">
      <div id="status" class="text-sm font-bold text-blue-600"></div>
      <button id="zipBtn" onclick="downloadAll()" class="hidden bg-gray-900 text-white px-10 py-4 rounded-full font-bold hover:bg-black transition-all shadow-xl active:scale-95">
        すべての画像をZIPで保存
      </button>
    </div>

    <div id="resultGrid" class="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"></div>
  </div>

  <script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const resultGrid = document.getElementById('resultGrid');
    const status = document.getElementById('status');
    const zipBtn = document.getElementById('zipBtn');

    let decoder = null;
    let processedFiles = [];

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

    dropZone.onclick = function() { fileInput.click(); };
    fileInput.onchange = function(e) {
      handleFiles(e.target.files);
      e.target.value = '';
    };

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

    async function handleFiles(files) {
      const fileList = Array.from(files);
      if (!fileList.length) return;

      // processedFiles = [];
      // resultGrid.innerHTML = '';
      // zipBtn.classList.add('hidden');

    const parallelLimit = 2;
      for (let i = 0; i < fileList.length; i += parallelLimit) {
        const chunk = fileList.slice(i, i + parallelLimit);
        await Promise.all(chunk.map(async function(file) {
          let uploadFile = file;

          if (file.name.toLowerCase().endsWith('.heic')) {
            status.innerText = "HEICデコード中...";
            try {
              const jpgBlob = await convertHeicToJpg(file);
              uploadFile = new File([jpgBlob], file.name.replace(/\\.heic$/i, ".jpg"), { type: "image/jpeg" });
            } catch (e) {
              console.error("HEIC Error:", e);
              return;
            }
          }

          const formData = new FormData();
          formData.append('file', uploadFile);

          try {
            status.innerText = "圧縮中...";
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const blob = await res.blob();

            processedFiles.push({ name: uploadFile.name, blob: blob });
            addPreview(URL.createObjectURL(blob), uploadFile.name);
          } catch (err) {
            status.innerText = "通信エラー";
            console.error(err);
          }
        }));
      }
      status.innerText = "完了 (合計: " + processedFiles.length + "枚)";
      if (processedFiles.length > 0) zipBtn.classList.remove('hidden');
    }

    function addPreview(url, name) {
      const div = document.createElement('div');
      div.className = "bg-white p-2 rounded-2xl shadow-sm border border-gray-100 animate-fade-in text-center";
      div.innerHTML = 
        '<img src="' + url + '" class="w-full h-32 object-cover rounded-xl mb-2">' +
        '<p class="text-[10px] text-gray-400 truncate mb-1">' + name + '</p>' +
        '<a href="' + url + '" download="min_' + name + '" class="text-xs text-blue-500 font-bold hover:underline">保存</a>';
      resultGrid.appendChild(div);
    }

    async function downloadAll() {
      const zip = new JSZip();
      processedFiles.forEach(function(f, i) {
        zip.file(i + "_" + f.name, f.blob);
      });
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = "images.zip";
      link.click();
    }
  </script>
</body>
</html>
`;
