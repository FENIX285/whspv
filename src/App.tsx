/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo } from 'react';
import { UserContext } from './context';
import { UserContextType } from './types';
import Login from './components/Login';
import MainLayout from './components/MainLayout';
import { rtcManager } from './webrtc';

export default function App() {
  const [userContextData, setUserContextData] = useState<Omit<UserContextType, 'logout'> | null>(null);

  const userContext = useMemo(() => {
    if (!userContextData) return null;
    return {
      ...userContextData,
      logout: () => {
        rtcManager.disconnect();
        setUserContextData(null);
      }
    };
  }, [userContextData]);

  return (
    <UserContext.Provider value={userContext}>
      {userContext ? <MainLayout /> : <Login onLogin={setUserContextData} />}
    </UserContext.Provider>
  );
}

