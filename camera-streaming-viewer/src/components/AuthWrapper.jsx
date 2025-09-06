import React, { useState, useEffect } from 'react';
import { AuthService } from '../services/authService';
import AuthPage from './AuthPage/AuthPage';
import MainApp from './MainApp/MainApp'; // Your current main component

export default function AuthWrapper() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [emailVerified, setEmailVerified] = useState(false);

        useEffect(() => {
        const unsubscribe = AuthService.onAuthStateChanged(async (authUser) => {
            if (authUser) {
                const userData = await AuthService.getUserData(authUser.uid);
                const isVerified = await AuthService.checkEmailVerification();
                
                setUser({ ...authUser, ...userData });
                setEmailVerified(isVerified);
                
                // If verified, the main app can now connect to socket
                if (isVerified) {
                    console.log('User authenticated and verified, ready for socket connection');
                }
            } else {
                setUser(null);
                setEmailVerified(false);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (loading) {
        return <div>Loading...</div>;
    }

    if (!user || !emailVerified) {
        return <AuthPage />;
    }

    // Pass user data to your existing app
    return <MainApp user={user} />;
}
