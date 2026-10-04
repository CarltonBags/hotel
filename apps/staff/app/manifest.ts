import type { MetadataRoute } from "next";

/** Installable on the home screen: the phone view opens on its own (ticket 35). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hoteloftware",
    short_name: "Hoteloftware",
    start_url: "/floor",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#0071e3",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
