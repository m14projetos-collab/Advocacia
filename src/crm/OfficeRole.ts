import { createContext, useContext } from "react";
export const OfficeRole = createContext<"staff" | "admin">("staff");
export const useOfficeRole = () => useContext(OfficeRole);
