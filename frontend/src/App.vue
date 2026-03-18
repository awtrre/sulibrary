<template>
  <div class="min-h-screen bg-[#111111] text-neutral-200 font-sans selection:bg-neutral-600 selection:text-white">
    
    <div v-show="!currentReadingBook" class="max-w-6xl mx-auto px-6 md:px-12 flex flex-col min-h-screen">
      
      <header class="flex flex-col md:flex-row items-center justify-between py-12 gap-6 relative">
        
        <div class="flex-1 hidden md:block"></div>
        
        <h1 class="text-2xl md:text-4xl font-light tracking-[0.5em] text-center flex-1 text-neutral-100">
          S U L I B R A R Y
        </h1>
        
        <div class="flex-1 flex justify-end items-center gap-4 w-full md:w-auto">
          <button
            @click="toggleTab"
            class="text-[10px] md:text-xs font-bold tracking-[0.2em] text-neutral-500 hover:text-neutral-100 transition-colors duration-300 whitespace-nowrap"
          >
            {{ activeTab === 'bookshelf' ? 'BOOKSTORE' : 'BOOKSHELF' }}
          </button>

          <input
            v-show="activeTab === 'bookshelf'"
            v-model="searchQuery"
            @keyup.enter="executeCommand"
            type="text"
            placeholder="/login or search..."
            class="w-full md:w-48 lg:w-64 bg-transparent border-b border-neutral-800 pb-1 text-xs md:text-sm text-neutral-300 focus:outline-none focus:border-neutral-500 transition-colors placeholder:text-neutral-700 tracking-wide"
          />
        </div>
      </header>

      <main class="flex-1 pb-16 pt-4">
        <BookshelfView
          v-show="activeTab === 'bookshelf'"
          :books="bookshelf"
          @openReader="openReader"
        />
        <BookstoreView
          v-show="activeTab === 'bookstore'"
        />
      </main>
    </div>

    <EpubReader
      v-if="currentReadingBook"
      :book="currentReadingBook"
      @close="closeReader"
    />

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { v4 as uuidv4 } from 'uuid';

import EpubReader from './components/EpubReader.vue';
import BookshelfView from './views/BookshelfView.vue';
import BookstoreView from './views/BookstoreView.vue';

const activeTab = ref('bookshelf'); 
const currentReadingBook = ref(null);
const bookshelf = ref([]);
const isGuest = ref(true);

// 搜索框数据绑定
const searchQuery = ref('');

const toggleTab = () => {
  activeTab.value = activeTab.value === 'bookshelf' ? 'bookstore' : 'bookshelf';
};

onMounted(() => {
  checkIdentity();
  fetchBookshelf();
});

const checkIdentity = () => {
  const token = localStorage.getItem('geek_token');
  if (token) {
    isGuest.value = false;
    return;
  }
  let guestUuid = localStorage.getItem('guest_uuid');
  if (!guestUuid) {
    guestUuid = uuidv4();
    localStorage.setItem('guest_uuid', guestUuid);
  }
  isGuest.value = true;
};

// 修复回车触发逻辑
const executeCommand = () => {
  const query = searchQuery.value.trim();
  if (!query) return;

  const loginMatch = query.match(/^\/login\s+(\w+)\s+(.+)$/);

  if (loginMatch) {
    const username = loginMatch[1];
    console.log(`🪄 收到登录指令！欢迎：${username}`);
    localStorage.setItem('geek_token', 'fake_token_123');
    isGuest.value = false;
    fetchBookshelf();
    searchQuery.value = ''; // 执行完清空输入框
    return;
  }

  if (query === '/logout') {
    console.log('🚪 断开连接...');
    localStorage.removeItem('geek_token');
    isGuest.value = true;
    bookshelf.value = [];
    fetchBookshelf();
    searchQuery.value = '';
    return;
  }

  console.log(`🔍 正在搜索：${query}`);
  searchQuery.value = ''; // 模拟搜索后清空
};

const API_BASE = 'http://127.0.0.1:8000'; // 替换成你树莓派的实际 IP 和端口

const fetchBookshelf = async () => {
  try {
    const response = await fetch('/api/books', {
      headers: {
        'user-token': localStorage.getItem('geek_token') || '',
        'guest-uuid': localStorage.getItem('guest_uuid') || ''
      }
    });
    const data = await response.json();
    if (data.status === 'success') {
      bookshelf.value = data.books;
    }
  } catch (error) {
    console.error('🕸️ 呼叫后端数据库失败:', error);
    bookshelf.value = [];
  }
};
const openReader = (book) => {
  currentReadingBook.value = book;
};

const closeReader = () => {
  currentReadingBook.value = null;
};
</script>
