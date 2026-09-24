let io = null;

function initSocket(serverIo) {
  io = serverIo;

  io.on('connection', (socket) => {
    // console.log(`[Socket Connected]: ${socket.id}`);

    // Join room for specific fixture
    socket.on('join_match', (fixtureId) => {
      if (fixtureId) {
        socket.join(`match_${fixtureId}`);
      }
    });

    socket.on('leave_match', (fixtureId) => {
      if (fixtureId) {
        socket.leave(`match_${fixtureId}`);
      }
    });

    socket.on('disconnect', () => {
      // console.log(`[Socket Disconnected]: ${socket.id}`);
    });
  });
}

function broadcastMatchUpdate(fixture) {
  if (!io) return;
  // Broadcast to global feed
  io.emit('fixture_updated', fixture);
  // Broadcast to room
  if (fixture?._id) {
    io.to(`match_${fixture._id}`).emit('match_state', fixture);
  }
}

function broadcastMatchEvent(eventData) {
  if (!io) return;
  io.emit('new_match_event', eventData);
  if (eventData?.fixture) {
    io.to(`match_${eventData.fixture}`).emit('match_event_added', eventData);
  }
}

function broadcastStandingsUpdate(standings) {
  if (!io) return;
  io.emit('standings_updated', standings);
}

module.exports = {
  initSocket,
  broadcastMatchUpdate,
  broadcastMatchEvent,
  broadcastStandingsUpdate,
  getIo: () => io
};
