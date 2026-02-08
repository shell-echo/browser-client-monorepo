const name = "browser-client-monorepo";

const constant = {
  name,
  extension: {
    name,
    description: "Browser Extension Client",
    event: {
      transport: {
        message: {
          type: `${name}-extension-event` as const,
        },
      },
    },
    invoke: {
      transport: {
        message: {
          type: `${name}-extension-invoke` as const,
        },
      },
    },
  },
};

export default constant;
