const __extension_origin_network__ = {
  fetch: window.fetch.bind(window),
  xhr: {
    open: XMLHttpRequest.prototype.open,
    send: XMLHttpRequest.prototype.send,
    setRequestHeader: XMLHttpRequest.prototype.setRequestHeader,
  },
};

const __extension_network_hook__ = {
  fetch: { request: {}, response: {} },
  xhr: { send: {} },
};

const __extension_network_hook_run__ = (funcs, args) => {
  for (const [name, func] of Object.entries(funcs)) {
    try {
      func(...args());
    } catch (e) {
      console.log(name, e);
    }
  }
};

window.fetch = function (input, init) {
  __extension_network_hook_run__(__extension_network_hook__.fetch.request, () => [input, init]);

  return __extension_origin_network__.fetch.apply(this, [input, init]).then((response) => {
    __extension_network_hook_run__(__extension_network_hook__.fetch.response, () => [input, init, response.clone()]);

    return response;
  });
};

const getXhrMeta = (xhr) => {
  if (xhr.__hook_meta__) return xhr.__hook_meta__;
  Object.defineProperty(xhr, "__hook_meta__", {
    value: {
      method: undefined,
      url: undefined,
      async: true,
      user: undefined,
      password: undefined,
      headers: {},
      body: undefined,
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return xhr.__hook_meta__;
};

XMLHttpRequest.prototype.open = function (method, url, async = true, user = null, password = null) {
  const meta = getXhrMeta(this);
  meta.method = method;
  meta.url = typeof url === "string" ? url : String(url);
  meta.async = async;
  meta.user = user;
  meta.password = password;

  return __extension_origin_network__.xhr.open.apply(this, arguments);
};
XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  const meta = getXhrMeta(this);
  meta.headers[String(name).toLowerCase()] = String(value);

  return __extension_origin_network__.xhr.setRequestHeader.apply(this, arguments);
};
XMLHttpRequest.prototype.send = function (body) {
  const meta = getXhrMeta(this);
  meta.body = body;

  __extension_network_hook_run__(__extension_network_hook__.xhr.send, () => [meta, this]);

  return __extension_origin_network__.xhr.send.apply(this, arguments);
};

const __extension_network_hook_register__ = (hook) => ({
  on: (name, func) => {
    hook[name] = func;
  },
  off: (name) => {
    delete hook[name];
  },
  hook,
});

window.__NETWORK_HOOK__ = {
  fetch: {
    request: __extension_network_hook_register__(__extension_network_hook__.fetch.request),
    response: __extension_network_hook_register__(__extension_network_hook__.fetch.response),
  },
  xhr: { send: __extension_network_hook_register__(__extension_network_hook__.xhr.send) },
};

window.dispatchEvent(new CustomEvent("__EXTENSION_INJECT_READY__", {}));
