export interface Contact {
  contactId: string;
  alias: string;
  mutual: boolean;
  online: boolean;
}

export interface UserContextType {
  userId: string;
  seed: string;
  aesKey: CryptoKey | null;
  logout: () => void;
}
