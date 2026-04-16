const DB_NAME = "ninja-lab";
const DB_VERSION = 1;
const STORE_NAME = "attempts";

export interface Attempt {
  id: number;
  video: Blob;
  annotations: Shape[];
  annotationTime: number;
  notes: string;
  createdAt: string;
}

export interface Shape {
  type: "line" | "arrow" | "circle";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    request.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

export function saveAttempt(attempt: Attempt): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(attempt);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  });
}

export function getAllAttempts(): Promise<Attempt[]> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as Attempt[]);
      request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  });
}

export function getAttempt(id: number): Promise<Attempt | undefined> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result as Attempt | undefined);
      request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  });
}

export function deleteAttempt(id: number): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  });
}
