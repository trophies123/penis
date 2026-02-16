const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6 // 5MB лимит для изображений
});

app.use(express.static(__dirname));
app.use(express.json({ limit: '5mb' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Хранилище данных
const users = new Map();
const messages = [];
let nextAnonymousNumber = 1;

io.on('connection', (socket) => {
  console.log('🔵 Новое подключение:', socket.id);

  socket.on('register', (userToken) => {
    let user = users.get(userToken);
    let isNewUser = false;

    if (!user) {
      user = {
        anonymousNumber: nextAnonymousNumber++,
        socketId: socket.id,
        lastSeen: new Date()
      };
      users.set(userToken, user);
      isNewUser = true;
      console.log(`✅ Новый аноним #${user.anonymousNumber}`);
      
      io.emit('system message', {
        text: `👋 Аноним ${user.anonymousNumber} присоединился к чату`
      });
    } else {
      user.socketId = socket.id;
      user.lastSeen = new Date();
      users.set(userToken, user);
      console.log(`🔄 Аноним #${user.anonymousNumber} переподключился`);
    }

    socket.emit('init', {
      anonymousNumber: user.anonymousNumber,
      messages: messages.slice(-200)
    });

    const activeUsers = Array.from(users.values())
      .filter(u => u.socketId)
      .map(u => u.anonymousNumber);
    io.emit('users online', activeUsers);
  });

  // Обработка сообщений (текст + изображения)
  socket.on('chat message', (data) => {
    let sender = null;
    for (let [token, user] of users.entries()) {
      if (user.socketId === socket.id) {
        sender = user;
        break;
      }
    }

    if (!sender) return;

    const messageData = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      anonymousNumber: sender.anonymousNumber,
      type: data.type || 'text', // 'text' или 'image'
      text: data.text ? data.text.substring(0, 500) : null,
      image: data.image || null, // base64 изображение
      replyTo: data.replyTo || null, // { id, anonymousNumber, text, type }
      timestamp: new Date().toLocaleTimeString('ru-RU', { 
        hour: '2-digit', 
        minute: '2-digit'
      })
    };

    messages.push(messageData);
    if (messages.length > 200) messages.shift();

    io.emit('chat message', messageData);
  });

  socket.on('typing', (isTyping) => {
    let sender = null;
    for (let [token, user] of users.entries()) {
      if (user.socketId === socket.id) {
        sender = user;
        break;
      }
    }
    if (sender) {
      socket.broadcast.emit('user typing', {
        anonymousNumber: sender.anonymousNumber,
        isTyping: isTyping
      });
    }
  });

  socket.on('disconnect', () => {
    let disconnectedUser = null;
    for (let [token, user] of users.entries()) {
      if (user.socketId === socket.id) {
        disconnectedUser = user;
        user.socketId = null;
        user.lastSeen = new Date();
        break;
      }
    }

    if (disconnectedUser) {
      console.log(`🔴 Аноним #${disconnectedUser.anonymousNumber} отключился`);
      
      const activeUsers = Array.from(users.values())
        .filter(u => u.socketId)
        .map(u => u.anonymousNumber);
      io.emit('users online', activeUsers);
      
      setTimeout(() => {
        const user = users.get(disconnectedUser.token);
        if (user && !user.socketId) {
          users.delete(token);
          io.emit('system message', {
            text: `👋 Аноним ${disconnectedUser.anonymousNumber} покинул чат`
          });
          
          const updatedActiveUsers = Array.from(users.values())
            .filter(u => u.socketId)
            .map(u => u.anonymousNumber);
          io.emit('users online', updatedActiveUsers);
        }
      }, 5 * 60 * 1000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
