// Jarvis — AI Personal Task Manager
// Frontend: chat UI only. All NLP handled by Gemini on the server.

(function () {
  'use strict';

  const API = 'https://jarviss-production-fb57.up.railway.app/api';

  // ── Chat UI refs ─────────────────────────────────────────
  const chatArea = document.getElementById('chatArea');
  const inputBar = document.getElementById('inputBar');
  const userInput = document.getElementById('userInput');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const newChatBtn = document.getElementById('newChatBtn');
  const exportPdfBtn = document.getElementById('exportPdfBtn');

  // Batching & UI State
  let pendingMessages = [];
  let batchTimeout = null;
  let typingIndicator = null;
  let currentSessionId = null;

  function setStatus(state) {
    statusDot.className = 'status-dot ' + state;
    const labels = { online: 'Online — Gemini AI', offline: 'Offline', '': 'Menghubungkan...' };
    statusText.textContent = labels[state] || labels[''];
  }

  // ── Helpers ──────────────────────────────────────────────

  function timeString(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Render Bubble ────────────────────────────────────────

  function addBubble(text, sender, tasks, timestamp, animate) {
    const wrapper = document.createElement('div');
    wrapper.className = `message message--${sender}`;
    if (animate === false) wrapper.style.animation = 'none';

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble';
    bubble.textContent = text;
    wrapper.appendChild(bubble);

    if (tasks && tasks.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'task-list';
      for (const t of tasks) {
        const li = document.createElement('li');
        li.className = 'task-item';
        li.innerHTML =
          `<span class="task-item__id">#${t.id}</span>` +
          `<span class="task-item__title">${escapeHtml(t.title)}</span>` +
          `<span class="task-item__priority task-item__priority--${t.priority}">${t.priority}</span>`;
        ul.appendChild(li);
      }
      bubble.appendChild(ul);
    }

    const time = document.createElement('span');
    time.className = 'message__time';
    time.textContent = timeString(timestamp);
    wrapper.appendChild(time);

    // Add PDF Download Button for Bot responses containing text/documents
    if (sender === 'bot' && text && !text.startsWith('Halo! 👋') && !text.startsWith('Tidak dapat terhubung')) {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'download-msg-pdf-btn';
      dlBtn.innerHTML = '📥 Unduh PDF';
      dlBtn.title = 'Ekspor pesan/tugas ini ke berkas PDF';
      dlBtn.addEventListener('click', () => {
        exportMessageToPDF('Hasil Tugas / Respons Jarvis', text);
      });
      wrapper.appendChild(dlBtn);
    }

    chatArea.appendChild(wrapper);
  }

  function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  // ── PDF Export Functionality ──────────────────────────────

  function exportMessageToPDF(docTitle, contentText) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('Library jsPDF sedang dimuat. Harap coba beberapa saat lagi.');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const maxLineWidth = pageWidth - margin * 2;
    let y = 20;

    // Header Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(45, 212, 191); // Teal accent color
    doc.text('JARVIS AI — DOKUMEN TUGAS', margin, y);
    y += 7;

    // Metadata Date
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(113, 113, 122);
    doc.text(`Tanggal Cetak: ${new Date().toLocaleString('id-ID')}`, margin, y);
    y += 6;

    // Horizontal Line
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // Section Title
    if (docTitle) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(30, 30, 35);
      const titleLines = doc.splitTextToSize(docTitle, maxLineWidth);
      doc.text(titleLines, margin, y);
      y += titleLines.length * 6 + 4;
    }

    // Main Content
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 45);

    const lines = doc.splitTextToSize(contentText, maxLineWidth);
    const lineHeight = 5.5;

    for (let i = 0; i < lines.length; i++) {
      if (y + lineHeight > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(lines[i], margin, y);
      y += lineHeight;
    }

    const filename = `Jarvis_Tugas_${Date.now()}.pdf`;
    doc.save(filename);
  }

  function exportCurrentSessionToPDF() {
    const messages = chatArea.querySelectorAll('.message');
    if (messages.length === 0) {
      alert('Tidak ada percakapan atau dokumen untuk diekspor.');
      return;
    }

    let fullContent = '';
    messages.forEach((msg) => {
      const isUser = msg.classList.contains('message--user');
      const textEl = msg.querySelector('.message__bubble');
      if (textEl) {
        const sender = isUser ? 'Pengguna' : 'Jarvis AI';
        fullContent += `[${sender}]\n${textEl.innerText.trim()}\n\n--------------------------------------------------\n\n`;
      }
    });

    exportMessageToPDF('Riwayat Percakapan & Tugas Aktivitas', fullContent);
  }

  // ── Load Chat History & Sessions ────────────────────────

  async function loadSessions() {
    try {
      const res = await fetch(`${API}/sessions`);
      if (!res.ok) throw new Error('server error');
      const sessions = await res.json();
      
      const chatList = document.getElementById('chatList');
      chatList.innerHTML = '';
      
      if (sessions.length > 0) {
        sessions.forEach(session => {
          const item = document.createElement('div');
          item.className = `chat-item${session.id === currentSessionId ? ' active' : ''}`;
          item.dataset.id = session.id;
          
          const title = document.createElement('span');
          title.className = 'chat-item-title';
          title.textContent = session.title || 'Percakapan Tanpa Judul';
          item.appendChild(title);
          
          const delBtn = document.createElement('button');
          delBtn.className = 'delete-chat-btn';
          delBtn.innerHTML = '🗑️';
          delBtn.title = 'Hapus Chat';
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('Apakah Anda yakin ingin menghapus obrolan ini?')) {
              await deleteSession(session.id);
            }
          });
          item.appendChild(delBtn);
          
          item.addEventListener('click', () => {
            selectSession(session.id);
          });
          
          chatList.appendChild(item);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.style.padding = '0 12px';
        empty.textContent = 'Tidak ada riwayat obrolan.';
        chatList.appendChild(empty);
      }
    } catch (e) {
      console.error('Gagal memuat sesi chat:', e);
    }
  }

  async function selectSession(id) {
    currentSessionId = id;
    
    // On mobile, close sidebar
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('open');
    
    // Highlight active session
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
      if (item.dataset.id === id) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    
    // Clear chat area
    chatArea.innerHTML = '';
    
    // Load messages for this session
    await loadHistory(id);
  }

  async function deleteSession(id) {
    try {
      const res = await fetch(`${API}/sessions?sessionId=${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('server error');
      
      if (currentSessionId === id) {
        // If active session was deleted, start a new chat
        startNewChat();
      } else {
        await loadSessions();
      }
    } catch (e) {
      alert('Gagal menghapus obrolan: ' + e.message);
    }
  }

  function startNewChat() {
    currentSessionId = 'session_' + Date.now();
    chatArea.innerHTML = '';
    
    // Highlight none active
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => item.classList.remove('active'));
    
    addBubble(
      'Halo! 👋 Saya Jarvis, asisten tugas pribadi Anda.\n\n' +
      'Anda bisa meminta saya membuatkan tugas seperti:\n' +
      '• "Buatkan makalah/ringkasan materi X"\n' +
      '• "Buat laporan rencana proyek Y"\n' +
      '• "Tambah tugas beli susu penting"\n' +
      '• "Lihat daftar tugas"\n\n' +
      'Hasil tugas dapat diunduh langsung sebagai dokumen PDF! 📄',
      'bot', null, null, false
    );
    scrollToBottom();
    
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('open');
  }

  async function loadHistory(sessionId) {
    try {
      const url = sessionId ? `${API}/messages?sessionId=${sessionId}` : `${API}/messages`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('server error');
      setStatus('online');
      const messages = await res.json();
      if (messages.length === 0) {
        addBubble(
          'Halo! 👋 Saya Jarvis, asisten tugas pribadi Anda.\n\n' +
          'Anda bisa meminta saya membuatkan tugas seperti:\n' +
          '• "Buatkan makalah/ringkasan materi X"\n' +
          '• "Buat laporan rencana proyek Y"\n' +
          '• "Tambah tugas beli susu penting"\n' +
          '• "Lihat daftar tugas"\n\n' +
          'Hasil tugas dapat diunduh langsung sebagai dokumen PDF! 📄',
          'bot', null, null, false
        );
      } else {
        for (const msg of messages) {
          addBubble(msg.text, msg.role, msg.tasks, msg.createdAt, false);
        }
      }
      scrollToBottom();
    } catch {
      setStatus('offline');
      addBubble(
        'Tidak dapat terhubung ke server. Pastikan Go server berjalan di port 8080.',
        'bot', null, null, false
      );
    }
  }

  // ── Send Message ─────────────────────────────────────────

  function showTypingIndicator() {
    if (!typingIndicator) {
      typingIndicator = document.createElement('div');
      typingIndicator.className = 'message message--bot';
      typingIndicator.innerHTML = '<div class="message__bubble typing-indicator">Jarvis sedang memproses tugas Anda<span class="dots">...</span></div>';
      chatArea.appendChild(typingIndicator);
      scrollToBottom();
    }
  }

  function hideTypingIndicator() {
    if (typingIndicator) {
      typingIndicator.remove();
      typingIndicator = null;
    }
  }

  async function sendMessage(text) {
    const msg = text.trim();
    if (!msg) return;

    // Show user bubble immediately
    addBubble(msg, 'user');
    scrollToBottom();

    // Add to batch queue
    pendingMessages.push(msg);

    // Ensure typing indicator is showing
    showTypingIndicator();

    // Reset timeout (debounce/batching window of 800ms)
    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }

    batchTimeout = setTimeout(async () => {
      const messagesToSend = [...pendingMessages];
      pendingMessages = [];
      batchTimeout = null;

      const payload = {
        messages: messagesToSend,
        sessionId: currentSessionId
      };

      try {
        const res = await fetch(`${API}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        // Hide typing indicator once this batch returns
        hideTypingIndicator();

        if (!res.ok) {
          const err = await res.text();
          addBubble(`Terjadi kesalahan: ${err}`, 'bot');
          scrollToBottom();
          return;
        }

        const data = await res.json();
        
        if (data.sessionId) {
          currentSessionId = data.sessionId;
        }

        addBubble(data.text, 'bot', data.tasks);
        scrollToBottom();
        
        await loadSessions();
      } catch (e) {
        hideTypingIndicator();
        setStatus('offline');
        addBubble(`Tidak dapat terhubung ke server: ${e.message}`, 'bot');
        scrollToBottom();
      }
    }, 800);
  }

  // ── Events ───────────────────────────────────────────────

  inputBar.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = userInput.value;
    userInput.value = '';
    sendMessage(val);
    userInput.focus();
  });

  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('open');
  });

  sidebarOverlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('open');
  });

  newChatBtn.addEventListener('click', () => {
    startNewChat();
  });

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', () => {
      exportCurrentSessionToPDF();
    });
  }

  // ── Init ─────────────────────────────────────────────────
  
  async function init() {
    try {
      const res = await fetch(`${API}/sessions`);
      if (!res.ok) throw new Error('server error');
      const sessions = await res.json();
      
      if (sessions.length > 0) {
        // Set the most recent session as active
        currentSessionId = sessions[0].id;
        await selectSession(currentSessionId);
      } else {
        currentSessionId = 'session_' + Date.now();
        startNewChat();
      }
      
      await loadSessions();
    } catch (e) {
      console.error('Init error:', e);
      setStatus('offline');
      currentSessionId = 'session_' + Date.now();
      startNewChat();
    }
  }

  init();
})();
