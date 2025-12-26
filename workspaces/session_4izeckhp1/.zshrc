
# Soft Jail for Basement IDE
export HOME="/Users/jaiminpansal/Documents/programs/baseement/workspaces/session_4izeckhp1"
export PS1="[basement] \w $ "
[ -f /etc/profile ] && . /etc/profile

alias cd='function _cd() { 
    if [ "$1" = ".." ] || [[ "$1" == *"../"* ]] || [[ "$1" == "/"* ]]; then
        if [[ "$(realpath -m "$PWD/$1")" != "/Users/jaiminpansal/Documents/programs/baseement/workspaces/session_4izeckhp1"* ]]; then
            echo "Access Denied: Cannot escape workspace";
            return 1;
        fi
    fi
    builtin cd "$@"; 
}; _cd'
