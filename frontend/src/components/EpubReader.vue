<template>
  <div class="fixed inset-0 bg-neutral-900 text-neutral-100 flex overflow-hidden z-50 font-sans select-none">
    
    <div class="relative h-full flex-grow border-r border-neutral-800 bg-black flex items-center justify-center overflow-hidden" ref="readerMain">
      
      <div id="viewer" ref="viewer" class="w-full h-full"></div>

      <SelectionOverlay 
        ref="selectionOverlayRef" 
        v-if="rendition" 
        :rendition="rendition" 
        @cancel-tap="clearTapTimer"
      />

      <div
        v-if="showBars"
        class="absolute inset-0 z-30"
        @click.stop="showBars = false"
        @touchstart.prevent="showBars = false"
      ></div>
    </div>

    <div 
      v-show="showBars" 
      class="absolute top-0 left-0 right-0 h-16 bg-neutral-900/95 backdrop-blur-md border-b border-neutral-800 flex justify-between items-center px-6 z-40 transition-transform duration-300 animate-fade-in"
    >
      <button @click="$emit('close')" class="text-neutral-400 hover:text-white text-sm tracking-widest font-mono transition-colors">
        ❮ BACK
      </button>
      <button @click="toggleTTS" class="text-neutral-400 hover:text-white text-sm tracking-widest font-mono flex items-center gap-2 transition-colors">
        <span>{{ isReading ? 'STOP' : 'READ' }}</span>
      </button>
    </div>

    <div 
      v-show="showBars" 
      class="absolute bottom-0 left-0 right-0 h-16 bg-neutral-900/95 backdrop-blur-md border-t border-neutral-800 flex justify-between items-center px-6 z-40 transition-transform duration-300 animate-fade-in"
    >
      <button @click="openTocOverlay" class="text-neutral-400 hover:text-white text-sm tracking-widest font-mono flex items-center gap-2 transition-colors">
        ☰
      </button>
      
      <div class="flex items-center gap-2 text-sm font-mono z-50">
        <input 
          v-model="inputPage" 
          @keyup.enter="jumpToTargetPage" 
          @focus="inputPage = ''" 
          @blur="inputPage = currentPage" 
          type="text" 
          class="w-12 text-center bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-sm py-1 outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 transition-all relative z-50" 
        />
        <span class="text-neutral-600">/ {{ totalPages }}</span>
      </div>

      <button @click="cycleFontSize" class="text-neutral-400 hover:text-white text-lg font-serif px-4 transition-colors">
        Aa
      </button>
    </div>

    <div v-if="showTocOverlay" class="fixed inset-0 bg-neutral-900 z-50 flex flex-col animate-fade-in">
      <div class="h-16 border-b border-neutral-800 flex justify-between items-center px-8">
        <button @click="showTocOverlay = false" class="text-neutral-500 hover:text-neutral-200 text-sm tracking-widest transition-colors font-mono">
          ✕ EXIT
        </button>
        <div class="flex gap-8 text-sm font-bold tracking-widest">
          <button @click="activeOverlayTab = 'toc'" :class="activeOverlayTab === 'toc' ? 'text-neutral-100 border-b-2 border-neutral-100' : 'text-neutral-600 hover:text-neutral-400'" class="pb-1 transition-all">目录</button>
          <button @click="activeOverlayTab = 'highlights'" :class="activeOverlayTab === 'highlights' ? 'text-neutral-100 border-b-2 border-neutral-100' : 'text-neutral-600 hover:text-neutral-400'" class="pb-1 transition-all">勾画</button>
          <button @click="activeOverlayTab = 'notes'" :class="activeOverlayTab === 'notes' ? 'text-neutral-100 border-b-2 border-neutral-100' : 'text-neutral-600 hover:text-neutral-400'" class="pb-1 transition-all">批注</button>
        </div>
        <div class="w-16"></div> 
      </div>
      
      <div class="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full scrollbar-hide">
        <ul v-if="activeOverlayTab === 'toc'" class="space-y-4">
          <li v-for="item in tocList" :key="item.id" @click="jumpToCfiAndClose(item.href)" class="text-neutral-400 hover:text-neutral-100 cursor-pointer border-b border-neutral-800 pb-2 transition-colors">
            {{ item.label }}
          </li>
        </ul>
        <div v-else class="text-center text-neutral-600 mt-20 font-mono text-sm">
          No data recorded yet.
        </div>
      </div>
    </div>

    <audio ref="ttsPlayer" @ended="handleAudioEnded" @error="handleAudioError" class="hidden"></audio>

  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import ePub from 'epubjs';
import SelectionOverlay from './SelectionOverlay.vue';
const selectionOverlayRef = ref(null);

const props = defineProps({
  book: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['close']);
const clearTapTimer = () => clearTimeout(tapActionTimer);

// --- DOM 引用 ---
const viewer = ref(null);
const readerMain = ref(null);
const ttsPlayer = ref(null);

// --- 核心实例 ---
let epubBook = null;
let rendition = null;
let unitMap = [];
const backendApi = '/api';

// --- 界面控制状态 ---
const showBars = ref(false);
const showTocOverlay = ref(false);
const activeOverlayTab = ref('toc');

// --- 数据与分页状态 ---
const tocList = ref([]);
const currentPage = ref('-');
const totalPages = ref('-');
const inputPage = ref('-');
const currentFontSize = ref(100);
let isJumpLocked = false;

// --- TTS 引擎状态 ---
const isReading = ref(false);
let currentSpineIndex = 0;
let textNodes = [];
let currentNodeIndex = 0;

// --- ✨选词与批注专属状态 ---
let isPointerDown = false; 
let uiWasOpen = false;   
let tapActionTimer = null;
let lastClickTime = 0;

// ==========================================
// 主题注入：适配 Paginated 模式的流式布局
// ==========================================
const applyTheme = () => {
  if (!rendition) return;
  
  rendition.themes.default({
    // 1. 地毯式颜色覆盖：把所有基础和内联标签的底色变黑，文字变灰
    'body, p, span, a, b, i, em, strong, div, blockquote, ul, ol, li, section, article': {
      'background-color': '#000000 !important',
      'color': '#d4d4d4 !important',
      'font-family': 'system-ui, -apple-system, sans-serif !important', 
      '-webkit-touch-callout': 'none !important',
    },    
    
    // 2. 标题特殊对待：颜色提亮为纯白，保留呼吸感间距
    'h1, h2, h3, h4, h5, h6': {
      'background-color': '#000000 !important',
      'color': '#ffffff !important',
      'line-height': '1.4 !important',
      'margin-top': '1.5em !important',
      'margin-bottom': '1em !important',
    },

    // 3. 段落排版约束：控制行高和首行缩进
    'p': {
      'line-height': '1.6 !important',
      'margin-top': '0 !important', 
      'margin-bottom': '1em !important',
    },

    // 4. 图片防御机制（防止撑破单页）
    'img, svg, video': {
      'display': 'block !important', 
      'margin': '1em auto !important', 
      'max-width': '100% !important',
      'max-height': '80vh !important' 
    },

    // 5. 选词高亮
    '::selection': {
      'background': '#262626 !important', 
      'color': '#ffffff !important' // 确保被选中的文字保持纯白
    },
    // 6. ✨ 新增：高亮防覆盖机制
    '.custom-hl': {
      'pointer-events': 'auto !important',       // 保证它依然能被点击
      'user-select': 'none !important',          // 彻底禁止在这个高亮块上二次划词
      '-webkit-user-select': 'none !important'
    }
  });
};
// ==========================================
// 1. 生命周期与初始化 (重构极简版)
// ==========================================
onMounted(() => {
  initReader();
});

onUnmounted(() => {
  if (epubBook) {
    epubBook.destroy(); // 销毁实例，释放内存 [cite: 2]
  }
});

const initReader = async () => {
  try {
    // 1. 实例化书籍
    epubBook = ePub(`/api/static/books/${props.book.id}/`); 

    // 2. 进度拉取逻辑
    let savedCfi = null;
    let isReadyToSave = false;
    const progressCacheKey = `offline_progress_${props.book.id}`;
    
    try {
      const res = await fetch(`/api/books/${props.book.id}/progress`, {
        headers: {
          'user-token': localStorage.getItem('geek_token') || '',
          'guest-uuid': localStorage.getItem('guest_uuid') || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        savedCfi = data.cfi;
        if (data.font_size) currentFontSize.value = data.font_size;
      }
    } catch (e) {
      // 联网失败则读取本地缓存 [cite: 5]
      savedCfi = localStorage.getItem(progressCacheKey);
    }

    // 拉取 unit_map.json (用于 unit-X 坐标的精准转换)
    try {
      const mapRes = await fetch(`/api/static/books/${props.book.id}/unit_map.json`);
      if (mapRes.ok) unitMap = await mapRes.json();
    } catch (e) { 
      console.warn("⚠️ 未找到 unit_map.json"); 
    }

    // 3. 阅读器渲染配置 [cite: 2]
    rendition = epubBook.renderTo(viewer.value, {
      width: '100%', 
      height: '100%', 
      flow: 'paginated', 
      manager: 'default',
      spread: 'none',      
      allowScriptedContent: true
    });

    applyTheme(); // 应用黑白灰主题
    rendition.themes.fontSize(`${currentFontSize.value}%`);

    // 4. Iframe 内部事件拦截：交给子组件 SelectionOverlay 处理 [cite: 2]
    rendition.on('rendered', (e, iframe) => {
      const doc = iframe.document;
      doc.addEventListener('selectionchange', () => {
        const selection = iframe.window.getSelection();
        if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
          selectionOverlayRef.value?.hideMenuOnly();
        }
      });

      const finalizeSelection = () => {
        isPointerDown = false;
        setTimeout(() => { selectionOverlayRef.value?.showPendingMenu(); }, 50);
      };
      doc.addEventListener('touchend', finalizeSelection);
      doc.addEventListener('mouseup', finalizeSelection);
    });

    // 5. 计算初始空降位置
    let targetLocation = savedCfi;
    let initialPageNumber = 0;

    // 核心跳转逻辑：如果是 unit-X 格式，根据 map 映射到具体文件锚点
    if (savedCfi && savedCfi.startsWith('unit-') && unitMap.length > 0) {
      const targetUnitId = parseInt(savedCfi.split('-')[1], 10);
      initialPageNumber = targetUnitId; 
      const mapItem = unitMap.find(m => targetUnitId >= m.start && targetUnitId <= m.end);
      if (mapItem) targetLocation = `${mapItem.href}#${savedCfi}`;
    }

    // 同步 UI 状态
    currentPage.value = initialPageNumber;
    inputPage.value = initialPageNumber;
    totalPages.value = props.book.total_units || '-';

    // 执行展示
    await rendition.display(targetLocation || undefined);
    if (viewer.value) viewer.value.classList.add('animate-fade-in');
    
    // 延迟 500ms 激活雷达，防止初始化时的虚假跳转触发重复保存
    setTimeout(() => { isReadyToSave = true; }, 500);

    // 6. 进度雷达：监听翻页并寻找 unit-X 锚点 [cite: 2]
    rendition.on('relocated', (location) => {
      if (!location || !isReadyToSave || isJumpLocked) return;
      
      try {
        const contents = rendition.getContents()[0];
        const iframeDoc = contents.document;
        const iframe = iframeDoc.defaultView.frameElement;
        const iframeOffset = iframe.getBoundingClientRect().left; 
        const viewWidth = window.innerWidth;
        
        const targets = Array.from(iframeDoc.querySelectorAll('.sync-anchor'));
        let foundElement = targets.find(el => {
          const rect = el.getBoundingClientRect();
          const absoluteLeft = rect.left + iframeOffset;
          return absoluteLeft >= -10 && absoluteLeft < viewWidth;
        });

        if (foundElement) {
          const preciseId = foundElement.id; 
          const unitMatch = preciseId.match(/unit-(\d+)/);
          const total = props.book.total_units || 1; 

          if (unitMatch) {
            const currentUnit = parseInt(unitMatch[1]);
            currentPage.value = currentUnit;
            inputPage.value = currentUnit;
            saveProgressToBackend(preciseId, currentUnit / total); 
          }
        }
      } catch (e) {
        console.error("💥 雷达程序崩溃:", e);
      }
    });

    // 7. 绑定划词事件
    rendition.on('selected', (cfiRange, contents) => {
      const text = rendition.getRange(cfiRange).toString().trim();
      if (!text) return;
      const range = contents.window.getSelection().getRangeAt(0);
      // 调用解耦后的子组件进行坐标计算和菜单显示
      selectionOverlayRef.value?.processSelection(cfiRange, text, range, contents, isPointerDown);
    });

    // 8. 绑定点击交互
    setupIframeClick();

  } catch (err) {
    console.error("💥 阅读器初始化失败:", err);
  }
};
// ==========================================
// 2. 交互与布局控制 (极致简化版)
// ==========================================
// iframe 内部点击监听
const setupIframeClick = () => {
  let startX = 0;
  let startY = 0;

  const recordStart = (e) => {
    isPointerDown = true;
      // ✨ 向子组件查询：当前是否有任何菜单处于打开状态？
      uiWasOpen = showBars.value || showTocOverlay.value || selectionOverlayRef.value?.isAnyUIOpen();
      
      selectionOverlayRef.value?.hideMenuOnly(); // 点按瞬间强行闭合所有UI

      const event = e.changedTouches ? e.changedTouches[0] : e;
      startX = event.clientX;
      startY = event.clientY;
  };

  const handlePointerUp = (e) => {
    isPointerDown = false; 
    // ✨ 触控结束，告诉子组件：如果是拖拽选词结束，可以把挂起的选单弹出来了
    setTimeout(() => {
      selectionOverlayRef.value?.showPendingMenu();
    }, 50);
    const now = Date.now();
    if (now - lastClickTime < 300) return; 
    lastClickTime = now;

    const event = e.changedTouches ? e.changedTouches[0] : e;
    const endX = event.clientX;
    const endY = event.clientY;
    const deltaX = Math.abs(endX - startX);
    const deltaY = Math.abs(endY - startY);


    // 🛡️ 拦截器 1：使用刚拍好的“快照”来判断！
    // 如果按下瞬间有 UI 挡着，说明用户的核心诉求是“退出 UI”，绝对不许翻页！
    if (uiWasOpen) {
      showBars.value = false;
      showTocOverlay.value = false;
      
      const contents = rendition.getContents()[0];
      if (contents) contents.window.getSelection().removeAllRanges();
      return; 
    }

    if (deltaX > 10 || deltaY > 10) return;

    const contents = rendition.getContents()[0];
    const selection = contents ? contents.window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return;

    // ⚡ 修复 2：给“翻页/呼出菜单”加上 80ms 的生死时速延迟！
    // 为什么？为了让 Epub.js 有时间去触发“点击了高亮块”的事件
    clearTimeout(tapActionTimer);
    tapActionTimer = setTimeout(() => {
      const screenWidth = window.innerWidth;
      const realX = endX % screenWidth; 
      if (realX < screenWidth * 0.3) {
        rendition.prev();
      } else if (realX > screenWidth * 0.7) {
        rendition.next();
      } else {
        showBars.value = !showBars.value; 
      }
    }, 80); // 80ms 对人类视觉是毫无延迟感的
  };

  rendition.on('mousedown', recordStart);
  rendition.on('mouseup', handlePointerUp);
  rendition.on('touchstart', recordStart);
  rendition.on('touchend', handlePointerUp);
};

// 外层触控蒙版监听
const handleTouch = (event) => {
  const rect = readerMain.value.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const width = rect.width;
  if (showTocOverlay.value || selectionOverlayRef.value?.isAnyUIOpen()) return;
  if (clickX < width * 0.3) {
    rendition.prev();
  } else if (clickX > width * 0.7) {
    rendition.next();
  } else {
    showBars.value = !showBars.value;
  }
};

const openTocOverlay = () => {
  showBars.value = false;
  showTocOverlay.value = true;
  epubBook.loaded.navigation.then(nav => {
    // 定义一个递归辅助函数来展平目录
    const flattenToc = (items, level = 0) => {
      return items.reduce((acc, item) => {
        const indent = level > 0 ? '　'.repeat(level) : '';
        acc.push({
          ...item,
          label: indent + item.label // 修改显示文案
        });
        if (item.subitems && item.subitems.length > 0) {
          acc.push(...flattenToc(item.subitems, level + 1));
        }
        return acc;
      }, []);
    };
    tocList.value = flattenToc(nav.toc);
  });
};

const jumpToCfiAndClose = (cfiOrHref) => {
  rendition.display(cfiOrHref);
  showTocOverlay.value = false;
};

// ==========================================
// 3. 选词高亮与维基反代加载
// ==========================================

const handleRelocated = (location) => {
  try {
    const contents = rendition.getContents()[0];
    const iframe = contents.document.defaultView.frameElement;
    const iframeOffset = iframe.getBoundingClientRect().left; 
    const targets = Array.from(contents.document.querySelectorAll('.sync-anchor'));
    let found = targets.find(el => {
      const rect = el.getBoundingClientRect();
      const absLeft = rect.left + iframeOffset;
      return absLeft >= -10 && absLeft < window.innerWidth;
    });

    if (found) {
      const unitMatch = found.id.match(/unit-(\d+)/);
      if (unitMatch) {
        const currentUnit = parseInt(unitMatch[1]);
        currentPage.value = currentUnit;
        inputPage.value = currentUnit;
        saveProgressToBackend(found.id, currentUnit / (props.book.total_units || 1));
      }
    }
  } catch (e) { console.error("Radar Error", e); }
};

const handleSelection = (cfiRange, contents) => {
  if (showBars.value) {
    contents.window.getSelection().removeAllRanges();
    return;
  }
  const text = rendition.getRange(cfiRange).toString().trim();
  if (!text) return;
  const range = contents.window.getSelection().getRangeAt(0);
  // ✨ 转发给子组件处理
  selectionOverlayRef.value?.processSelection(cfiRange, text, range, contents, isPointerDown);
};
// ==========================================
// 4. 分页与排版 (秒开极简版)
// ==========================================
let saveTimer = null;

const saveProgressToBackend = (cfi, progress) => {
  // 无论如何，先把最新进度刻印在本地 (这里的 cfi 已经是缝合好的 "epubcfi(...)|__|unit-X")
  localStorage.setItem(`offline_progress_${props.book.id}`, cfi);
  
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch(`/api/books/${props.book.id}/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'user-token': localStorage.getItem('geek_token') || '',
        'guest-uuid': localStorage.getItem('guest_uuid') || ''
      },
      // 🐛 细节修复：后端 main.py 接收的是 "percent"，这里统一对齐
      body: JSON.stringify({ cfi: cfi, percent: progress }) 
    })
    .then(res => {
      if (res.ok) {
        // 🌐 联网保存成功，清理掉可能存在的"待同步"标记
        localStorage.removeItem(`sync_pending_${props.book.id}`);
      }
    })
    .catch(() => {
      // 📴 断网打上标记
      localStorage.setItem(`sync_pending_${props.book.id}`, 'true');
      console.log("📴 离线保存成功，已打上待同步标记！");
    });
  }, 2000);
};

// 🚀 极客空降法 (精简版)
const jumpToTargetPage = () => {
  const targetUnit = parseInt(inputPage.value);
  const total = parseInt(totalPages.value);

  if (isNaN(targetUnit) || targetUnit < 0 || targetUnit > total) {
    inputPage.value = currentPage.value;
    return;
  }
  
  if (unitMap.length > 0) {
    const mapItem = unitMap.find(m => targetUnit >= m.start && targetUnit <= m.end);
    if (mapItem) {
      const preciseId = `unit-${targetUnit}`; // 只保留 unit-X 格式
      const progress = targetUnit / total;
      saveProgressToBackend(preciseId, progress); 
      currentPage.value = targetUnit;
      rendition.display(`${mapItem.href}#${preciseId}`).then(() => {
        showBars.value = false;
        isJumpLocked = true;
        setTimeout(() => { isJumpLocked = false; }, 500);
      });
    }
  }
};

const cycleFontSize = async () => {
  const sizes = [80, 100, 120, 140];
  const currentIndex = sizes.indexOf(currentFontSize.value);
  currentFontSize.value = sizes[(currentIndex + 1) % sizes.length];
  if (viewer.value) {  // 1. ✨ 开启蒙版隐身效果，并锁住雷达探测
    viewer.value.style.transition = 'opacity 0.2s';
    viewer.value.style.opacity = '0';
  }
  isJumpLocked = true; 
  rendition.themes.fontSize(`${currentFontSize.value}%`);   // 2. ✨ 更改 Epub 内部字号
  const targetUnit = currentPage.value;  // 3. ✨ 精确打击：利用你的 map 机制，找到当前所在的位置并强制空降
  if (unitMap.length > 0 && targetUnit !== '-') {
    const mapItem = unitMap.find(m => targetUnit >= m.start && targetUnit <= m.end);
    if (mapItem) {
      const preciseId = `unit-${targetUnit}`;
      await rendition.display(`${mapItem.href}#${preciseId}`);
    }
  }
  setTimeout(() => {   // 4. ✨ 等待渲染稳固后，解除蒙版，解锁雷达
    if (viewer.value) viewer.value.style.opacity = '1';
    isJumpLocked = false;
  }, 300);
  fetch(`/api/books/${props.book.id}/prefs`, {  // 5. ✨ 将最新字号保存给后端（路径改为这本特定的书）
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'user-token': localStorage.getItem('geek_token') || '',
      'guest-uuid': localStorage.getItem('guest_uuid') || ''
    },
    body: JSON.stringify({ font_size: currentFontSize.value })
  });
};

// ==========================================
// 5. TTS 赛博播音员
// ==========================================
const toggleTTS = async () => {
  if (isReading.value) {
    ttsPlayer.value.pause();
    isReading.value = false;
    return;
  }
  
  isReading.value = true;
  const currentLocation = rendition.currentLocation();
  if (!currentLocation) return;
  
  currentSpineIndex = currentLocation.start.index;
  await extractAndPrepareText();
};

const extractAndPrepareText = async () => {
  const spineItem = epubBook.spine.get(currentSpineIndex);
  await spineItem.load(epubBook.load.bind(epubBook));
  const chapterText = spineItem.document.body.textContent || spineItem.document.body.innerText;
  
  textNodes = chapterText
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？!?])/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
    
  currentNodeIndex = 0;
  playNextSentence();
};

const playNextSentence = () => {
  if (!isReading.value) return;

  if (currentNodeIndex < textNodes.length) {
    const textToRead = textNodes[currentNodeIndex];
    const ttsApiUrl = `${backendApi}/tts/synthesize`;
    ttsPlayer.value.src = `${ttsApiUrl}?text=${encodeURIComponent(textToRead)}&voice=zh_CN-huayan-medium`;
    ttsPlayer.value.play();
    currentNodeIndex++;
  } else {
    jumpToNextChapter();
  }
};

const handleAudioEnded = () => {
  playNextSentence();
};

const handleAudioError = (e) => {
  console.error("TTS 音频流加载失败:", e);
  isReading.value = false;
};

const jumpToNextChapter = async () => {
  currentSpineIndex++;
  if (currentSpineIndex >= epubBook.spine.length) {
    isReading.value = false;
    return;
  }
  await rendition.display(epubBook.spine.get(currentSpineIndex).href);
  await extractAndPrepareText();
};
</script>

<style scoped>
#viewer {
  width: 100%;
  height: 100dvh; 
  /* 禁止文本跨列被截断 */
  column-fill: auto;
  opacity: 0;
}

.animate-fade-in {
  animation: fadeIn 0.2s ease-out forwards;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.wiki-content :deep(a) { 
  color: #a3a3a3; 
  text-decoration: underline; 
}
.wiki-content :deep(p) { 
  color: #d4d4d4; 
  margin-bottom: 1em;
}
.wiki-content :deep(h1), 
.wiki-content :deep(h2), 
.wiki-content :deep(h3) { 
  color: #f5f5f5; 
  font-weight: bold; 
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
</style>