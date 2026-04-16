<template>
  <div
    v-if="showSelectionMenu"
    class="absolute z-50 bg-neutral-900 border border-neutral-800 shadow-2xl flex items-center font-mono text-xs tracking-widest animate-fade-in"
    :style="{ top: selectionMenuPos.y + 'px', left: selectionMenuPos.x + 'px', transform: 'translate(-50%, -100%)', marginTop: '-12px' }"
  >
    <button @click="copyText" class="px-5 py-3 text-neutral-400 hover:text-white transition-colors">COPY</button>
    <div class="w-px h-4 bg-neutral-800"></div>
    <button @click="searchInWiki" class="px-5 py-3 text-neutral-400 hover:text-white transition-colors">SEARCH</button>
    <div class="w-px h-4 bg-neutral-800"></div>
    <button v-if="!isSelectionOverlapping" @click="markAnnotation" class="px-5 py-3 text-neutral-400 hover:text-white transition-colors">MARK</button>
    <button v-else @click="deleteOverlappingAnnotation" class="px-5 py-3 text-neutral-400 hover:text-white transition-colors">DELETE</button>

    <div class="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-full w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-neutral-900"></div>
    <div class="absolute left-1/2 bottom-[-1px] transform -translate-x-1/2 translate-y-full w-0 h-0 border-l-[7px] border-r-[7px] border-t-[7px] border-transparent border-t-neutral-800 -z-10"></div>
  </div>

  <div v-if="showAnnotationPanel" class="fixed inset-0 z-50 flex flex-col justify-end animate-fade-in">
    <div class="absolute inset-0" @click="closeAnnotationPanel"></div>
    <div class="relative h-1/2 bg-neutral-900 border-t border-neutral-800 flex flex-col pointer-events-auto">
      <div class="flex justify-start gap-8 px-8 py-4 border-b border-neutral-800 text-xs font-mono tracking-widest bg-neutral-900">
        <button @click="copyText" class="text-neutral-500 hover:text-neutral-100 transition-colors outline-none focus:outline-none">COPY</button>
        <button @click="searchInWiki" class="text-neutral-500 hover:text-neutral-100 transition-colors outline-none focus:outline-none">SEARCH</button>
        <button v-if="!isSelectionOverlapping" @click="markAnnotation" class="text-neutral-500 hover:text-neutral-100 transition-colors outline-none focus:outline-none">MARK</button>
        <button v-else @click="deleteOverlappingAnnotation" class="text-neutral-500 hover:text-neutral-100 transition-colors outline-none focus:outline-none">DELETE</button>
      </div>
      <textarea 
        v-model="currentNoteText" 
        @input="syncNote"
        class="flex-1 bg-transparent p-8 outline-none text-neutral-300 resize-none" 
        placeholder="Write something..."
      ></textarea>
    </div>
  </div>

  <div v-if="showWiki" class="fixed inset-0 z-50 flex flex-col justify-end animate-fade-in">
    <div class="absolute inset-0" @click="closeWiki"></div>
    <div class="relative h-1/2 bg-neutral-900 border-t border-neutral-800 flex flex-col pointer-events-auto">
      <div class="flex justify-start gap-8 px-8 py-4 border-b border-neutral-800 text-xs font-mono tracking-widest bg-neutral-900">
        <button @click="copyText" class="text-neutral-500 hover:text-neutral-100 transition-colors outline-none focus:outline-none">COPY</button>
        <button @click="switchToAnnotation" class="text-neutral-500 hover:text-neutral-100 transition-colors outline-none focus:outline-none">ANNOTATION</button>
        <button v-if="!isSelectionOverlapping" @click="markAnnotation" class="text-neutral-500 hover:text-neutral-100 transition-colors outline-none focus:outline-none">MARK</button>
        <button v-else @click="deleteOverlappingAnnotation" class="text-neutral-500 hover:text-neutral-100 transition-colors outline-none focus:outline-none">DELETE</button>
      </div>
      <div class="flex-1 overflow-y-auto p-8">
        <div class="wiki-content prose prose-neutral prose-invert max-w-none text-sm" v-html="wikiContent"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';

// 接收父组件传来的 Epub 核心引擎，用于执行高亮的物理绘制
const props = defineProps({
  rendition: {
    type: Object,
    required: true
  }
});

// 向父组件汇报特定事件（比如绘制高亮时需要拦截父组件的点击翻页）
const emit = defineEmits(['cancel-tap']);

// --- 状态封闭化：原 EpubReader 中的 UI 状态全部迁移至此 ---
const showSelectionMenu = ref(false);
const selectionMenuPos = ref({ x: 0, y: 0 }); 
const currentSelection = ref({ cfi: null, text: '', segments: [] });
const isSelectionOverlapping = ref(false);
const showAnnotationPanel = ref(false);
const currentNoteText = ref('');
const showWiki = ref(false);
const wikiContent = ref('');

const annotationDataMap = reactive({});
const activeHighlightCfi = ref(null);

let pendingSelection = null;
let overlappingCfi = null;

// --- 核心方法：提取选中坐标 (原封不动) ---
const extractSegments = (range, doc) => {
  const segmentsMap = {};
  let root = range.commonAncestorContainer;
  if (root.nodeType === 3) root = root.parentNode; 

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentNode;

  while ((currentNode = walker.nextNode())) {
    if (!range.intersectsNode(currentNode)) continue;
    const targetEl = currentNode.parentElement ? currentNode.parentElement.closest('[id]') : null;
    if (!targetEl) continue;

    const nodeId = targetEl.id;
    const preRange = doc.createRange();
    preRange.selectNodeContents(targetEl);
    preRange.setEnd(currentNode, 0); 
    const prefixLen = preRange.toString().length;

    let start = currentNode === range.startContainer ? range.startOffset : 0;
    let end = currentNode === range.endContainer ? range.endOffset : currentNode.length;
    
    if (start === end) continue;

    const blockStart = prefixLen + start;
    const blockEnd = prefixLen + end;

    if (!segmentsMap[nodeId]) {
      segmentsMap[nodeId] = { nodeX: nodeId, startOffset: blockStart, endOffset: blockEnd };
    } else {
      segmentsMap[nodeId].startOffset = Math.min(segmentsMap[nodeId].startOffset, blockStart);
      segmentsMap[nodeId].endOffset = Math.max(segmentsMap[nodeId].endOffset, blockEnd);
    }
  }
  return Object.values(segmentsMap);
};

// --- 对外暴露的通信接口 1：处理原生选区 ---
const processSelection = (cfiRange, text, range, contents, isPointerDown) => {
  const currentSegments = extractSegments(range, contents.document);
  isSelectionOverlapping.value = false;
  overlappingCfi = null;

  // 碰撞检测
  for (const [savedCfi, savedData] of Object.entries(annotationDataMap)) {
    const isOverlap = currentSegments.some(currSeg => {
      return savedData.segments.some(savedSeg => {
        if (currSeg.nodeX !== savedSeg.nodeX) return false;
        return Math.max(currSeg.startOffset, savedSeg.startOffset) < Math.min(currSeg.endOffset, savedSeg.endOffset);
      });
    });
    if (isOverlap) {
      isSelectionOverlapping.value = true;
      overlappingCfi = savedCfi;
      break;
    }
  }

  // 计算物理位置
  const rect = range.getBoundingClientRect();
  const iframe = contents.document.defaultView.frameElement;
  const iframeRect = iframe.getBoundingClientRect();
  const pos = { 
    x: rect.left + iframeRect.left + (rect.width / 2), 
    y: rect.top + iframeRect.top 
  };

  const selectionData = { cfi: cfiRange, text: text, pos: pos, segments: currentSegments };

  if (isPointerDown) {
    pendingSelection = selectionData;
  } else {
    selectionMenuPos.value = pos;
    currentSelection.value = selectionData;
    showSelectionMenu.value = true;
  }
};

// --- 对外暴露的通信接口 2：释放挂起的选区 ---
const showPendingMenu = () => {
  if (pendingSelection) {
    selectionMenuPos.value = pendingSelection.pos;
    currentSelection.value = { ...pendingSelection };
    showSelectionMenu.value = true;
    pendingSelection = null;
  }
};
const hideMenuOnly = () => {
  showSelectionMenu.value = false;
  pendingSelection = null;
};
// --- 对外暴露的通信接口 3：一键闭合与状态探针 ---
const closeAll = () => {
  showSelectionMenu.value = false;
  showAnnotationPanel.value = false;
  showWiki.value = false;
  pendingSelection = null;
  clearNativeSelection();
};

const isAnyUIOpen = () => {
  return showSelectionMenu.value || showAnnotationPanel.value || showWiki.value;
};

// --- 内部逻辑层 (完全复用原代码) ---
const clearNativeSelection = () => {
  if (props.rendition) {
    const contents = props.rendition.getContents()[0];
    if (contents) contents.window.getSelection().removeAllRanges();
  }
};

const closeWiki = () => {
  showWiki.value = false;
  clearNativeSelection(); 
};

const closeAnnotationPanel = () => {
  showAnnotationPanel.value = false;
  clearNativeSelection(); 
};

const deleteOverlappingAnnotation = () => {
  if (overlappingCfi) {
    props.rendition.annotations.remove(overlappingCfi, 'highlight');
    delete annotationDataMap[overlappingCfi];
    
    isSelectionOverlapping.value = false;
    overlappingCfi = null;
    activeHighlightCfi.value = null; 
    currentNoteText.value = ''; 
    
    showSelectionMenu.value = false; 
    showAnnotationPanel.value = false; 
    clearNativeSelection(); 
  }
};

const syncNote = () => {
  if (!isSelectionOverlapping.value) markAnnotation(); 
  if (overlappingCfi && annotationDataMap[overlappingCfi]) {
    annotationDataMap[overlappingCfi].note = currentNoteText.value;
  }
};

const copyText = () => {
  if (currentSelection.value && currentSelection.value.text) {
    navigator.clipboard.writeText(currentSelection.value.text);
    if (!showWiki.value && !showAnnotationPanel.value) {
      showSelectionMenu.value = false;
      clearNativeSelection(); 
    }
  }
};

const searchInWiki = () => {
  if (currentSelection.value && currentSelection.value.text) {
    showSelectionMenu.value = false; 
    showAnnotationPanel.value = false; 
    summonReference(currentSelection.value.text);
  }
};

const switchToAnnotation = () => {
  showSelectionMenu.value = false; 
  showWiki.value = false;
  currentNoteText.value = isSelectionOverlapping.value && overlappingCfi ? (annotationDataMap[overlappingCfi]?.note || '') : '';
  showAnnotationPanel.value = true;
};

const markAnnotation = () => {
  const cfi = currentSelection.value.cfi;
  
  if (!annotationDataMap[cfi]) {
    annotationDataMap[cfi] = {
      text: currentSelection.value.text,
      segments: currentSelection.value.segments, 
      note: currentNoteText.value 
    };
  } else {
    annotationDataMap[cfi].note = currentNoteText.value;
  }

  isSelectionOverlapping.value = true;
  overlappingCfi = cfi;
  activeHighlightCfi.value = cfi;

  props.rendition.annotations.add(
    'highlight', cfi, {}, 
    (e) => {
      const contents = props.rendition.getContents()[0];
      const selection = contents ? contents.window.getSelection() : null;
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return;

      emit('cancel-tap'); // ✨ 通知父级掐断翻页定时器
      
      isSelectionOverlapping.value = true;
      overlappingCfi = cfi;
      activeHighlightCfi.value = cfi;
      currentSelection.value = { 
        text: annotationDataMap[cfi].text, cfi: cfi, segments: annotationDataMap[cfi].segments
      };

      currentNoteText.value = annotationDataMap[cfi].note || '';     
      showAnnotationPanel.value = true;
    }, 
    'custom-hl', 
    { "fill": "#808080", "fill-opacity": "0.3", "mix-blend-mode": "multiply" } 
  );
  
  showSelectionMenu.value = false; 
  clearNativeSelection(); 
};

const summonReference = async (query) => {
  showWiki.value = true;
  wikiContent.value = '<p class="text-neutral-500 font-mono text-center mt-10">⏳ Connecting to portal...</p>';
  setTimeout(() => {
    wikiContent.value = `
      <h1 class="text-2xl text-neutral-100 mb-4">${query}</h1>
      <p class="text-neutral-300 leading-relaxed">
        这是从后端拉取的 <strong>${query}</strong> 的解释。
      </p>
    `;
  }, 800);
};

// 暴露供父组件调用的武器库
defineExpose({
  processSelection,
  showPendingMenu,
  closeAll,
  isAnyUIOpen,
  hideMenuOnly
});
</script>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.2s ease-out forwards;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.wiki-content :deep(a) { color: #a3a3a3; text-decoration: underline; }
.wiki-content :deep(p) { color: #d4d4d4; margin-bottom: 1em; }
.wiki-content :deep(h1), 
.wiki-content :deep(h2), 
.wiki-content :deep(h3) { 
  color: #f5f5f5; font-weight: bold; margin-top: 1.5em; margin-bottom: 0.5em;
}
</style>