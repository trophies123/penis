const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Отдаём статические файлы
app.use(express.static(__dirname));

// Для всех маршрутов отдаём index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Хранилище данных
const users = new Map(); // token -> { anonymousNumber, socketId, lastSeen }
const messages = []; // История сообщений с поддержкой ответов
let nextAnonymousNumber = 1;

io.on('connection', (socket) => {
  console.log('🔵 Новое подключение:', socket.id);

  // Регистрация пользователя
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
      messages: messages.slice(-100) // Последние 100 сообщений
    });

    // Отправляем список онлайн
    const activeUsers = Array.from(users.values())
      .filter(u => u.socketId)
      .map(u => u.anonymousNumber);
    io.emit('users online', activeUsers);
  });

  // Обработка текстовых сообщений с поддержкой ответов
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
      type: 'text',
      anonymousNumber: sender.anonymousNumber,
      text: data.text.substring(0, 1000),
      timestamp: new Date().toLocaleTimeString('ru-RU', { 
        hour: '2-digit', 
        minute: '2-digit'
      }),
      replyTo: data.replyTo || null // Добавляем информацию об ответе
    };

    messages.push(messageData);
    if (messages.length > 200) messages.shift(); // Храним больше сообщений

    io.emit('chat message', messageData);
  });

  // Обработка фотографий
  socket.on('chat photo', (data) => {
    let sender = null;
    for (let [token, user] of users.entries()) {
      if (user.socketId === socket.id) {
        sender = user;
        break;
      }
    }

    if (!sender) return;

    const photoData = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      type: 'photo',
      anonymousNumber: sender.anonymousNumber,
      photo: data.photo, // base64 изображение
      caption: data.caption ? data.caption.substring(0, 200) : '',
      timestamp: new Date().toLocaleTimeString('ru-RU', { 
        hour: '2-digit', 
        minute: '2-digit'
      }),
      replyTo: data.replyTo || null
    };

    messages.push(photoData);
    if (messages.length > 200) messages.shift();

    io.emit('chat message', photoData);
  });

  // Индикатор печатания
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

  // Отключение
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
      
      // Обновляем список онлайн
      const activeUsers = Array.from(users.values())
        .filter(u => u.socketId)
        .map(u => u.anonymousNumber);
      io.emit('users online', activeUsers);
      
      // Удаляем неактивных через 5 минут
      setTimeout(() => {
        let userStillExists = false;
        for (let [token, user] of users.entries()) {
          if (user.anonymousNumber === disconnectedUser.anonymousNumber && user.socketId) {
            userStillExists = true;
            break;
          }
        }
        
        if (!userStillExists) {
          for (let [token, user] of users.entries()) {
            if (user.anonymousNumber === disconnectedUser.anonymousNumber) {
              users.delete(token);
              io.emit('system message', {
                text: `👋 Аноним ${disconnectedUser.anonymousNumber} покинул чат`
              });
              break;
            }
          }
          
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
