import React, { useState } from 'react';
import { AuthService } from '../../services/authService';
import './AuthPage.css';

export default function AuthPage() {
    const [isSignUp, setIsSignUp] = useState(false);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [showEmailVerification, setShowEmailVerification] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });
    
    // Form data
    const [loginData, setLoginData] = useState({ email: '', password: '' });
    const [signupData, setSignupData] = useState({ email: '', password: '', displayName: '' });
    const [resetEmail, setResetEmail] = useState('');

    // Replace these with your actual AuthService imports
    
    
    const handleSignUp = async (e) => {
        if (e) e.preventDefault();
        try {
            console.log('Starting signup process...', signupData);
            await AuthService.signUp(signupData.email, signupData.password, signupData.displayName);
            setMessage({ text: 'Account created! Please check your email for verification link.', type: 'success' });
            setShowEmailVerification(true);
        } catch (error) {
            console.error('Signup error:', error);
            setMessage({ text: error.message, type: 'error' });
        }
    };

    const handleSignIn = async (e) => {
        if (e) e.preventDefault();
        try {
            console.log('Starting signin process...', loginData);
            await AuthService.signIn(loginData.email, loginData.password);
            setMessage({ text: 'Signed in successfully!', type: 'success' });
        } catch (error) {
            console.error('Signin error:', error);
            setMessage({ text: error.message, type: 'error' });
        }
    };

    const handleForgotPassword = async (e) => {
        if (e) e.preventDefault();
        try {
            console.log('Password reset for:', resetEmail);
            await AuthService.sendPasswordReset(resetEmail);
            setMessage({ text: 'Password reset email sent! Check your inbox.', type: 'success' });
            setShowForgotPassword(false);
            setResetEmail('');
        } catch (error) {
            console.error('Password reset error:', error);
            setMessage({ text: error.message, type: 'error' });
        }
    };

    const handleSendVerificationEmail = async () => {
        try {
            console.log('Resending verification email');
            await AuthService.sendEmailVerification();
            setMessage({ text: 'Verification email sent! Check your inbox.', type: 'success' });
        } catch (error) {
            console.error('Verification email error:', error);
            setMessage({ text: error.message, type: 'error' });
        }
    };

    const handleCheckEmailVerification = async () => {
        try {
            console.log('=== CHECKING EMAIL VERIFICATION ===');
            
            const isVerified = await AuthService.checkEmailVerification();
            
            console.log('Email verification status:', isVerified);
            
            if (isVerified) {
                setMessage({ text: 'Email verified successfully! You can now access the system.', type: 'success' });
                setShowEmailVerification(false);
                // The AuthWrapper will handle the redirect to main app
            } else {
                setMessage({ 
                    text: 'Email not yet verified. Please check your inbox and click the verification link.', 
                    type: 'error' 
                });
            }
        } catch (error) {
            console.error('=== EMAIL VERIFICATION CHECK ERROR ===');
            console.error(error);
            setMessage({ text: 'Error checking verification status. Please try again.', type: 'error' });
        }
    };

    const clearMessage = () => {
        setMessage({ text: '', type: '' });
    };

    // Handle Enter key for form submission
    const handleKeyPress = (e, submitFunction) => {
        if (e.key === 'Enter') {
            submitFunction(e);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                {/* Header */}
                <div className="auth-header">
                    <h1 className="auth-title">
                        📹 Camera Stream
                    </h1>
                    <p className="auth-subtitle">Secure access to your camera streaming system</p>
                </div>

                {/* Email Verification Screen */}
                {showEmailVerification ? (
                    <div className="verification-screen">
                        <div className="verification-content">
                            <div className="icon-circle email-icon">
                                <span>📧</span>
                            </div>
                            <h2 className="screen-title">Check Your Email</h2>
                            <p className="screen-description">
                                We've sent a verification link to your email address. Please verify your email to access the camera system.
                            </p>
                        </div>
                        
                        <div className="button-group">
                            <button
                                onClick={handleCheckEmailVerification}
                                className="btn btn-primary full-width"
                            >
                                I've Verified My Email
                            </button>
                            
                            <button
                                onClick={handleSendVerificationEmail}
                                className="btn btn-secondary full-width"
                            >
                                Resend Verification Email
                            </button>
                            
                            <button
                                onClick={() => setShowEmailVerification(false)}
                                className="btn btn-secondary full-width"
                            >
                                Back to Sign In
                            </button>
                        </div>
                    </div>
                ) : showForgotPassword ? (
                    /* Forgot Password Screen */
                    <div className="forgot-password-screen">
                        <div className="verification-content">
                            <div className="icon-circle reset-icon">
                                <span>🔐</span>
                            </div>
                            <h2 className="screen-title">Reset Password</h2>
                            <p className="screen-description">
                                Enter your email address and we'll send you a link to reset your password.
                            </p>
                        </div>
                        
                        <div className="form-group">
                            <label className="form-label">Email Address</label>
                            <input
                                type="email"
                                value={resetEmail}
                                onChange={(e) => setResetEmail(e.target.value)}
                                onKeyPress={(e) => handleKeyPress(e, handleForgotPassword)}
                                className="form-input"
                                placeholder="Enter your email address"
                                required
                            />
                        </div>
                        
                        <div className="button-group">
                            <button
                                onClick={handleForgotPassword}
                                className="btn btn-primary full-width"
                            >
                                Send Reset Link
                            </button>
                            
                            <button
                                onClick={() => {setShowForgotPassword(false); clearMessage();}}
                                className="btn btn-secondary full-width"
                            >
                                Back to Sign In
                            </button>
                        </div>
                    </div>
                ) : !isSignUp ? (
                    /* Sign In Form */
                    <div className="signin-form">
                        <h2 className="form-title">Sign In</h2>
                        
                        <div className="form-fields">
                            <div className="form-group">
                                <label className="form-label">Email Address</label>
                                <input
                                    type="email"
                                    value={loginData.email}
                                    onChange={(e) => setLoginData({...loginData, email: e.target.value})}
                                    onKeyPress={(e) => handleKeyPress(e, handleSignIn)}
                                    className="form-input"
                                    placeholder="your.email@example.com"
                                    required
                                />
                            </div>
                            
                            <div className="form-group">
                                <label className="form-label">Password</label>
                                <input
                                    type="password"
                                    value={loginData.password}
                                    onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                                    onKeyPress={(e) => handleKeyPress(e, handleSignIn)}
                                    className="form-input"
                                    placeholder="Enter your password"
                                    required
                                />
                            </div>
                        </div>
                        
                        <div className="button-group">
                            <button
                                onClick={handleSignIn}
                                className="btn btn-primary full-width"
                            >
                                Sign In to Camera System
                            </button>
                            
                            <div className="button-row">
                                <button
                                    onClick={() => {setIsSignUp(true); clearMessage();}}
                                    className="btn btn-success half-width"
                                >
                                    Create Account
                                </button>
                                
                                <button
                                    onClick={() => {setShowForgotPassword(true); clearMessage();}}
                                    className="btn btn-warning half-width"
                                >
                                    Forgot Password?
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Sign Up Form */
                    <div className="signup-form">
                        <h2 className="form-title">Create Account</h2>
                        
                        <div className="form-fields">
                            <div className="form-group">
                                <label className="form-label">Full Name</label>
                                <input
                                    type="text"
                                    value={signupData.displayName}
                                    onChange={(e) => setSignupData({...signupData, displayName: e.target.value})}
                                    onKeyPress={(e) => handleKeyPress(e, handleSignUp)}
                                    className="form-input"
                                    placeholder="John Doe"
                                    required
                                />
                            </div>
                            
                            <div className="form-group">
                                <label className="form-label">Email Address</label>
                                <input
                                    type="email"
                                    value={signupData.email}
                                    onChange={(e) => setSignupData({...signupData, email: e.target.value})}
                                    onKeyPress={(e) => handleKeyPress(e, handleSignUp)}
                                    className="form-input"
                                    placeholder="your.email@example.com"
                                    required
                                />
                            </div>
                            
                            <div className="form-group">
                                <label className="form-label">Password</label>
                                <input
                                    type="password"
                                    value={signupData.password}
                                    onChange={(e) => setSignupData({...signupData, password: e.target.value})}
                                    onKeyPress={(e) => handleKeyPress(e, handleSignUp)}
                                    className="form-input"
                                    placeholder="Create a strong password"
                                    minLength="6"
                                    required
                                />
                            </div>
                        </div>
                        
                        <div className="button-group">
                            <button
                                onClick={handleSignUp}
                                className="btn btn-success full-width"
                            >
                                Create Account
                            </button>
                            
                            <button
                                onClick={() => {setIsSignUp(false); clearMessage();}}
                                className="btn btn-secondary full-width"
                            >
                                Back to Sign In
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Message Display */}
                {message.text && (
                    <div className={`message ${message.type === 'error' ? 'message-error' : 'message-success'}`}>
                        <p>{message.text}</p>
                    </div>
                )}
                
                {/* Footer */}
                <div className="auth-footer">
                    <p>Secure authentication for camera streaming system</p>
                </div>
            </div>
        </div>
    );
}