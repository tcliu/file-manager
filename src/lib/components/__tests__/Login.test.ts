import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Login from '../Login.svelte';

const originalLocalStorage = globalThis.localStorage;
const mockStorage: Record<string, string> = {};

beforeAll(() => {
  const storage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, value: string) => { mockStorage[key] = value; },
    removeItem: (key: string) => { delete mockStorage[key]; },
    clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
    get length() { return Object.keys(mockStorage).length; },
    key: (index: number) => Object.keys(mockStorage)[index] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, writable: true });
});

describe('Login', () => {
  const defaultProps = {
    username: '',
    password: '',
    rememberMe: false,
    passwordVisible: false,
    loginStatusText: '',
    loginPending: false,
    onLogin: () => {},
  };

  it('renders login form', () => {
    render(Login, defaultProps);
    expect(screen.getByText('File Manager')).toBeTruthy();
    expect(screen.getByText('Sign in to access the file browser.')).toBeTruthy();
  });

  it('renders username input', () => {
    render(Login, defaultProps);
    const input = screen.getByLabelText('Username') as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it('renders password input', () => {
    render(Login, defaultProps);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('renders show password button', () => {
    render(Login, { ...defaultProps, passwordVisible: false });
    const toggleButton = screen.getByLabelText('Show password');
    expect(toggleButton).toBeTruthy();
  });

  it('shows password when visible', () => {
    render(Login, { ...defaultProps, passwordVisible: true });
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.type).toBe('text');
  });

  it('shows login pending text', () => {
    render(Login, { ...defaultProps, loginPending: true });
    expect(screen.getByText('Signing in...')).toBeTruthy();
  });

  it('shows login status text', () => {
    render(Login, { ...defaultProps, loginStatusText: 'Invalid credentials' });
    expect(screen.getByText('Invalid credentials')).toBeTruthy();
  });

  it('renders remember me checkbox', () => {
    render(Login, defaultProps);
    const checkbox = screen.getByLabelText('Remember me') as HTMLInputElement;
    expect(checkbox.type).toBe('checkbox');
    expect(checkbox.checked).toBe(false);
  });

  it('checks remember me when true', () => {
    render(Login, { ...defaultProps, rememberMe: true });
    const checkbox = screen.getByLabelText('Remember me') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
