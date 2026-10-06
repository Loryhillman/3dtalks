// Admission, closing and ending a meeting share one queue in this single-process
// server. Membership must be registered before a lifecycle operation takes its
// participant snapshot; a queued entrant must see the resulting room status.
let pending = Promise.resolve();

function runRoomOperation(operation) {
  const current = pending.then(operation);
  pending = current.catch(() => {});
  return current;
}

module.exports = { runRoomOperation };
