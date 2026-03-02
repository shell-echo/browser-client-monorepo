import { createBrowserRouter } from "react-router";

import NotFoundPage from "~/router/404";
import HomePage from "~/router/home";

const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  { path: "*", element: <NotFoundPage /> },
]);

export default router;
