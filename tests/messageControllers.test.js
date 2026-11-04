const assert = require("node:assert/strict");
const { test } = require("node:test");
const Conversation = require("../models/converation");
const messageControllers = require("../controllers/messageControllers");

const response = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("platform admins can see only support queue items and conversations they join", async (t) => {
  const originalFind = Conversation.find;
  let capturedQuery;
  Conversation.find = (query) => {
    capturedQuery = query;
    const chain = {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return chain;
  };
  t.after(() => {
    Conversation.find = originalFind;
  });

  const res = response();
  await messageControllers.listConversations(
    {
      user: { userId: "admin-id", role: "admin" },
      query: {},
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(capturedQuery.$and[1].$or, [
    { participants: "admin-id" },
    { type: "support", supportAssignee: null },
  ]);
});

test("archived inbox returns only conversations hidden by the requesting participant", async (t) => {
  const originalFind = Conversation.find;
  let capturedQuery;
  Conversation.find = (query) => {
    capturedQuery = query;
    const chain = {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return chain;
  };
  t.after(() => {
    Conversation.find = originalFind;
  });

  const res = response();
  await messageControllers.listConversations(
    {
      user: { userId: "user-id", role: "user" },
      query: { archived: "true" },
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(capturedQuery.$and[0].archivedBy, "user-id");
  assert.deepEqual(capturedQuery.$and[1].$or, [{ participants: "user-id" }]);
});

test("property users cannot list messages in a conversation they do not participate in", async (t) => {
  const originalFindOne = Conversation.findOne;
  Conversation.findOne = () => Promise.resolve(null);
  t.after(() => {
    Conversation.findOne = originalFindOne;
  });

  const res = response();
  await messageControllers.listMessages(
    {
      params: { conversationId: "64b000000000000000000001" },
      user: { userId: "64b000000000000000000002", role: "user" },
    },
    res,
  );

  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /not found/i);
});

test("sendMessage rejects nonparticipants before creating a message", async (t) => {
  const originalFindOne = Conversation.findOne;
  Conversation.findOne = () => Promise.resolve(null);
  t.after(() => {
    Conversation.findOne = originalFindOne;
  });

  const res = response();
  await messageControllers.sendMessage(
    {
      params: { conversationId: "64b000000000000000000001" },
      body: { clientMessageId: "client-1", text: "Hello" },
      user: { userId: "64b000000000000000000002", role: "user" },
      app: { get: () => undefined },
    },
    res,
  );

  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /not found/i);
});

test("only platform admins may create support queue entries by assignment", async (t) => {
  const originalFindOneAndUpdate = Conversation.findOneAndUpdate;
  let queried = false;
  Conversation.findOneAndUpdate = () => {
    queried = true;
    throw new Error("database should not be queried");
  };
  t.after(() => {
    Conversation.findOneAndUpdate = originalFindOneAndUpdate;
  });

  const res = response();
  await messageControllers.claimSupportConversation(
    {
      params: { conversationId: "64b000000000000000000001" },
      user: { userId: "64b000000000000000000002", role: "landlord" },
    },
    res,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(queried, false);
});

test("platform admins cannot initiate user support threads", async () => {
  const res = response();
  await messageControllers.getOrCreateSupportConversation(
    { user: { userId: "admin-id", role: "admin" } },
    res,
  );

  assert.equal(res.statusCode, 403);
});
