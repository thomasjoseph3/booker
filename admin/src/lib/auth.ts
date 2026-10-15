import "server-only";
import { cache } from "react";
import { api } from "./api";
import type { Hotel, User } from "./types";

// Deduplicated per request, so layouts and pages can all ask for these cheaply.
export const getMe = cache(() => api<User>("/auth/me"));
export const getHotels = cache(async () => (await api<{ items: Hotel[] }>("/hotels")).items);
export const getHotel = cache((hotelId: string) => api<Hotel>(`/hotels/${hotelId}`));

export const isManager = (u: User) => u.role === "super_admin" || u.role === "hotel_admin";
