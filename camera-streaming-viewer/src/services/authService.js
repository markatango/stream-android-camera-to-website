// authService.js
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    signOut as firebaseSignOut,
    sendPasswordResetEmail,
    sendEmailVerification,
    onAuthStateChanged,
    updateProfile,
    reload
} from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebaseConfig.js';

export class AuthService {
    // Sign up new user with email verification
    // In your AuthService.signUp method, modify it like this:
static async signUp(email, password, displayName) {
    console.log('=== AUTHSERVICE SIGNUP DEBUG ===');
    console.log('1. Starting signup for:', email);
    
    try {
        console.log('2. Creating user with Firebase Auth...');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log('3. User created successfully:', {
            uid: user.uid,
            email: user.email,
            emailVerified: user.emailVerified
        });

        console.log('4. Updating user profile...');
        await updateProfile(user, { displayName });
        console.log('5. Profile updated successfully');

        console.log('6. Attempting to send verification email...');
        console.log('   User object before sending email:', {
            uid: user.uid,
            email: user.email,
            emailVerified: user.emailVerified,
            displayName: user.displayName
        });

        // THIS IS THE CRITICAL PART - let's see if this throws an error
        await sendEmailVerification(user);
        console.log('7. ✅ Verification email sent successfully to:', user.email);

        console.log('8. Creating Firestore document...');
        await setDoc(doc(db, 'users', user.uid), {
            email,
            displayName,
            role: 'user',
            createdAt: serverTimestamp(),
            emailVerified: false,
            ownedDevices: []
        });
        console.log('9. ✅ Firestore document created successfully');

        return user;
    } catch (error) {
        console.error('=== AUTHSERVICE SIGNUP ERROR ===');
        console.error('Error at step:', error.message);
        console.error('Full error object:', error);
        throw error;
    }
}

    // Sign in existing user
    static async signIn(email, password) {
        if (!email || !password) {
            throw new Error('Please fill in all fields');
        }

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            console.log('User signed in successfully:', userCredential.user.email);
            return userCredential;
        } catch (error) {
            console.error('AuthService.signIn error:', error);
            throw error;
        }
    }

    // Sign out user
    static async signOut() {
        try {
            await firebaseSignOut(auth);
            console.log('User signed out successfully');
        } catch (error) {
            console.error('AuthService.signOut error:', error);
            throw new Error('Error signing out: ' + error.message);
        }
    }

    // Send password reset email
    static async sendPasswordReset(email) {
        if (!email) {
            throw new Error('Please enter your email address');
        }

        try {
            await sendPasswordResetEmail(auth, email);
            console.log('Password reset email sent to:', email);
        } catch (error) {
            console.error('AuthService.sendPasswordReset error:', error);
            if (error.code === 'auth/user-not-found') {
                throw new Error('No account found with this email address');
            }
            throw error;
        }
    }

    // Send email verification to current user
    static async sendEmailVerification() {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('No user is currently signed in');
        }

        if (user.emailVerified) {
            throw new Error('Email is already verified');
        }

        try {
            await sendEmailVerification(user);
            console.log('Verification email sent to:', user.email);
        } catch (error) {
            console.error('Error sending verification email:', error);
            throw new Error('Failed to send verification email: ' + error.message);
        }
    }

    // Check email verification status
    static async checkEmailVerification() {
        const user = auth.currentUser;
        if (!user) {
            return false;
        }

        try {
            // Reload user data from Firebase to get latest emailVerified status
            await reload(user);
            
            console.log('Email verification status after reload:', user.emailVerified);
            
            // Update Firestore if email verification status changed
            if (user.emailVerified) {
                await updateDoc(doc(db, 'users', user.uid), {
                    emailVerified: true
                });
                console.log('Updated emailVerified status in Firestore');
            }
            
            return user.emailVerified;
        } catch (error) {
            console.error('Error checking email verification:', error);
            return user.emailVerified;
        }
    }

    // Get user data from Firestore
    static async getUserData(uid) {
        try {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) {
                return userDoc.data();
            }
            return null;
        } catch (error) {
            console.error('Error getting user data:', error);
            return null;
        }
    }

    // Set up auth state listener
    static onAuthStateChanged(callback) {
        return onAuthStateChanged(auth, callback);
    }

    // Get current user
    static getCurrentUser() {
        return auth.currentUser;
    }

    // Check if current user's email is verified
    static isEmailVerified() {
        const user = auth.currentUser;
        return user ? user.emailVerified : false;
    }
}