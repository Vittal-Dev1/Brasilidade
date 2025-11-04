"use client";

import { useEffect, useState } from "react";
import LoginPage from "../app/login/page";
import Page from "../app/teste/page";

export default function Root() {
  const [auth, setAuth] = useState<null | boolean>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return setAuth(false);
    setAuth(true);
  }, []);

  if (auth === null) return <p>Carregando...</p>;

  return auth ? <Page /> : <LoginPage />;
}
