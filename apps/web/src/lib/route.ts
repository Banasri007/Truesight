import { useEffect, useState } from "react";

export interface Route {
  page: string;
  arg: string | null;
}

/** Hash routes: "#/" is the landing film, "#/<page>[/<arg>]" are console pages. */
function parseHash(): Route {
  const [path] = window.location.hash.replace(/^#\/?/, "").split("?");
  const [page, arg] = (path ?? "").split("/");
  return { page: page || "home", arg: arg ?? null };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = `#/${path}`;
}
